# 20a Uploads: Files and Images in the Chat

## Goal
People attach files and images to their chat messages, and the agents read them: a screenshot, a requirements document, a table of data. The files go through the server's storage interface and are data for the agents, never instructions.

Spec 20 is built in two parts. This part brings the uploads and how agents read them. Part 20b adds reading links, the web search and the knowledge of custom agents.

## Design decisions
- **Attaching** (handoff: "Attach" in the composer, until now without function):
  - The paperclip opens the file picker; images can also be pasted from the clipboard. Up to 5 files per message, each at most 10 MB (images 5 MB).
  - Allowed are images (PNG, JPEG, WebP, GIF), PDF and plain text formats (text, Markdown, CSV, JSON, YAML, XML, HTML as text, common source code). The server decides by the file's content, not by what the browser claims: images and PDFs by their signature, text by being valid UTF-8.
  - A file is uploaded as soon as it is chosen and shows as a chip above the text with its name and size, a spinner while it uploads, and "×" to take it off again. Sending the message attaches the uploaded files to it. A message still needs text.
- **In the chat** (derived look): a message shows its images as thumbnails and its other files as chips with icon, name and size. A click opens the image, or downloads the file.
- **Reading** (`architecture.md`, invariant 6: "Content from repositories, the web and uploads is data, not instructions"):
  - Every agent's context lists the files of the project (the latest 20) with name, kind, size, id and who attached them; in the chat lines a message names its attachments.
  - Every agent has the tool `read_file`: it returns a text file's content, a PDF's text page by page, or the image itself for the model to look at. Long content comes in parts.
  - What a file says is marked as data in the tool result, and the shared rules tell every agent to treat it as such.
- **Access:** members of the project read its files; owners and editors upload. Files are served only to members, as downloads with headers that keep the browser from running them; only images are shown inline.
- **Storage** (`architecture.md`: "storage interface on the server: a local folder, later S3-compatible"): the content lies in a folder under `.data/files`, under a key the server makes up; the database keeps name, kind, size and the key.
- **PDF text** needs a library: `unpdf` (MIT), which reads the text of each page. Scanned PDFs without text are reported as such.

## Implementation

### Database: migration `0014_files.sql`
- Table `files`: project, uploader, the message it is attached to (empty until the message is sent), name, kind (`image`, `pdf`, `text`), media type, size, storage key. RLS: members read; owners and editors insert their own uploads and attach them to their own messages of the same project.

### Shared: `packages/shared/src/`
- `MessageAttachment` on `ChatMessage`; `attachments` on the input of sending a message; the limits and the allowed kinds.

### Server
- **Storage:** `storage/` with the interface (`put`, `get`, `delete`) and the local folder; `FILES_DIR` for server and worker.
- **API:**
  - `POST /api/projects/:projectId/files` (multipart, one file): checks role, size and content, stores it and returns the attachment.
  - `GET /api/projects/:projectId/files/:fileId`: the content for members.
  - `DELETE /api/projects/:projectId/files/:fileId`: takes back an upload that is not attached yet.
  - Sending a message takes `attachments` and attaches the uploader's own unattached files.
- **Gateway:** a tool result can carry an image next to its text.
- **Agent turn:** the `<files>` section, attachments in the chat lines, and the tool `read_file`.
- **Tests:** RLS, the upload with every kind and every refusal, download headers, attaching, the tool for text, PDF and image, the prompt.

### Web
- **Composer:** attaching, pasting, the chips, sending with attachments.
- **Chat message:** thumbnails and file chips.
- **i18n:** `files.*`.

## Out of scope
- reading links and the web search, and files and links as the knowledge of a custom agent (spec 20b)
- Word, Excel and other office formats; text recognition in scanned PDFs
- messages without text, dragging files into the chat, deleting files of sent messages, and a list of all files of the project
- removing stored content when its project is deleted, and S3-compatible storage (with the deployment, spec 35)

## Dependencies
- Spec 19
- Packages: `unpdf` (server)

## Checklist
- [x] Owners and editors attach images, PDFs and text files to a message by picking or pasting; the files show as chips and can be taken off before sending.
- [x] The message shows its images as thumbnails and its files as chips for everyone, live; members open and download them, nobody else.
- [x] An agent asked about an attached text file, PDF or image reads it with `read_file` and answers from its content.
- [x] Files that are too large, of another kind or not what they claim are refused with a clear note; viewers cannot upload.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API, the tool, the agent turn and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-01)
- **Upload first, attach on sending:** `POST …/files` stores one file and returns its attachment (id, name, kind, media type, size); the row has no message yet. Sending a message with `attachments` checks that every id is the sender's own upload in this project, attached to nothing (or to this very message, so sending again after a lost answer works), and attaches them in the transaction that stores the message. RLS enforces the same: an uploader attaches only to an own message of the same project, and an attached file neither moves nor is deleted by clients.
- **What a file is, is decided by its content:** PNG, JPEG, GIF, WebP and PDF by their signature, whatever the file is called; text by a known extension plus valid UTF-8 without NUL bytes. SVG, office formats and programs are refused with `unsupported_file` (415). The name is reduced to its last path segment, without control characters, at most 200 characters with the extension kept.
- **Limits:** the body limit of the API stays 64 kB for everything but the upload route, which takes 10 MB plus the form envelope and is refused while it is read beyond that; images above 5 MB are refused after reading. 30 uploads per minute and person. An upload that was never sent is removed, with its content, the next time its uploader uploads after a day.
- **Serving:** only members get a file (RLS; a file of another project is 404). Images are served inline, everything else as a download; text always as `text/plain`, and every answer carries `nosniff` and a sandboxing content security policy, so an uploaded HTML page never runs in the app's origin.
- **Storage:** `FileStorage` (`put`, `get`, `delete`) with a local folder; keys are UUIDs the server makes up, and the storage refuses anything else. Locally the folder is `.data/files` (found from the module, so server and worker agree); the built server needs `FILES_DIR`, which the Docker image sets to `/data/files` on a volume shared by app and worker.
- **Agents:**
  - `read_file` is offered to every agent of the team except in a debate. It needs no rule, since it changes nothing.
  - Text comes in parts of at most 20,000 characters, cut at line ends; a PDF as the text of its pages (`unpdf`), which is then cut the same way; an image as an image in the tool result, which the gateway hands to the model (`runWithImage` next to `run`).
  - The content is quoted in `<file>` (it cannot close its own section) with the note that it is data. The context lists the latest 20 attached files in `<files>`, and a chat line names what its message has attached.
- **Web:** `useUploads` keeps the files of the message being written (uploading, done, taken off) and reports why a file was dropped; the composer shows them as chips, waits for running uploads and still needs text. Pasting files from the clipboard attaches them. A message shows images as thumbnails (lazily loaded, opened in a new tab) and other files as download chips.
- **Verified** with `pnpm dev` in the project "Vereins-App":
  - A Markdown file and an image were attached and showed as chips; `setup.exe` was refused with the note that only images, PDFs and text files work. A PDF with two pages was added, a fourth file was attached and taken off again.
  - The message showed the image as a thumbnail and the two files as chips; the image is served inline as `image/png`, the Markdown file as a `text/plain` download with `nosniff`.
  - "@Moderator Lies bitte die drei angehängten Dateien …" was answered from all three: the number of members from the Markdown file, the two lines of text on the image, and the first milestone from the PDF.
  - Viewers, other projects, the size limits and sending again are covered by the tests of the database, the API and the components; they were not tried live.
- **Known limits:** a message still needs text; files cannot be dragged into the chat; scanned PDFs have no text to read; stored content is not removed when its message or project is deleted (only the rows are); there is no list of all files of a project.
