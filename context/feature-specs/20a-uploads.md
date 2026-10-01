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
- [ ] Owners and editors attach images, PDFs and text files to a message by picking or pasting; the files show as chips and can be taken off before sending.
- [ ] The message shows its images as thumbnails and its files as chips for everyone, live; members open and download them, nobody else.
- [ ] An agent asked about an attached text file, PDF or image reads it with `read_file` and answers from its content.
- [ ] Files that are too large, of another kind or not what they claim are refused with a clear note; viewers cannot upload.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API, the tool, the agent turn and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
