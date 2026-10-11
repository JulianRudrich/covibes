import type { MessageAttachment } from '@covibes/shared';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@web/components/ui/tooltip';
import { ChatMessageView } from '@web/features/chat/chat-message';
import { Composer } from '@web/features/chat/composer';
import { AttachmentList } from '@web/features/files/attachment-list';
import { useUploads, type Uploads } from '@web/features/files/use-uploads';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

const IMAGE: MessageAttachment = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'skizze.png',
  kind: 'image',
  mediaType: 'image/png',
  sizeBytes: 340_200,
};
const NOTES: MessageAttachment = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Notizen.md',
  kind: 'text',
  mediaType: 'text/markdown',
  sizeBytes: 2_400_000,
};

type Call = { url: string; method: string; body: unknown };

/** Answers uploads with `respond` and everything else with "no content"; keeps the requests. */
function stubUploads(respond: (file: File) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body });
      if (method === 'POST' && init?.body instanceof FormData) {
        const file = init.body.get('file');
        if (!(file instanceof File)) throw new Error('No file in the form');
        return Promise.resolve(respond(file));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUploads', () => {
  function setup(respond: (file: File) => Response | Promise<Response>) {
    const calls = stubUploads(respond);
    const onProblem = vi.fn();
    const { result } = renderHook(() => useUploads(PROJECT, onProblem));
    return { calls, onProblem, result };
  }

  it('uploads a file as soon as it is chosen', async () => {
    let finish: (response: Response) => void = () => undefined;
    const { calls, result, onProblem } = setup(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );

    act(() => {
      result.current.add([file('skizze.png')]);
    });

    expect(result.current.items).toMatchObject([{ name: 'skizze.png', status: 'uploading' }]);
    expect(result.current.uploading).toBe(true);
    expect(result.current.attachments).toEqual([]);
    expect(calls).toMatchObject([{ url: `/api/projects/${PROJECT}/files`, method: 'POST' }]);
    // A form goes out as it is: the browser sets its type and boundary.
    expect(calls[0]?.body).toBeInstanceOf(FormData);

    await act(async () => {
      finish(json(IMAGE, 201));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.uploading).toBe(false);
    });
    expect(result.current.attachments).toEqual([IMAGE]);
    expect(onProblem).not.toHaveBeenCalled();
  });

  it('takes at most five files and none that is too large', () => {
    const { calls, result, onProblem } = setup(() => new Promise<Response>(() => undefined));

    act(() => {
      result.current.add([
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'riesig.pdf'),
        ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => file(`${name}.md`)),
      ]);
    });

    expect(result.current.items.map((item) => item.name)).toEqual([
      'a.md',
      'b.md',
      'c.md',
      'd.md',
      'e.md',
    ]);
    expect(onProblem.mock.calls).toEqual([
      ['too_large', 'riesig.pdf'],
      ['too_many', 'f.md'],
    ]);
    expect(calls).toHaveLength(5);
  });

  it('drops a file the server refuses, with the reason', async () => {
    const { result, onProblem } = setup((upload) =>
      json(
        { error: { code: upload.name.endsWith('.exe') ? 'unsupported_file' : 'too_large' } },
        upload.name.endsWith('.exe') ? 415 : 413,
      ),
    );

    act(() => {
      result.current.add([file('setup.exe'), file('gross.png')]);
    });

    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });
    expect(onProblem.mock.calls).toEqual(
      expect.arrayContaining([
        ['unsupported', 'setup.exe'],
        ['too_large', 'gross.png'],
      ]),
    );
    // There is room again for five files.
    act(() => {
      result.current.add(['a', 'b', 'c', 'd', 'e'].map((name) => file(`${name}.exe`)));
    });
    expect(result.current.items).toHaveLength(5);
  });

  it('takes a file off again and removes it from the server', async () => {
    const { calls, result } = setup(() => json(IMAGE, 201));
    act(() => {
      result.current.add([file('skizze.png')]);
    });
    await waitFor(() => {
      expect(result.current.attachments).toEqual([IMAGE]);
    });

    act(() => {
      result.current.remove(result.current.items[0]?.localId ?? '');
    });

    expect(result.current.items).toEqual([]);
    expect(calls.at(-1)).toMatchObject({
      url: `/api/projects/${PROJECT}/files/${IMAGE.id}`,
      method: 'DELETE',
    });
  });

  it('forgets the files after sending, without removing them', async () => {
    const { calls, result } = setup(() => json(IMAGE, 201));
    act(() => {
      result.current.add([file('skizze.png')]);
    });
    await waitFor(() => {
      expect(result.current.attachments).toEqual([IMAGE]);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.items).toEqual([]);
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });
});

describe('Composer with files', () => {
  function uploadsWith(overrides: Partial<Uploads> = {}): Uploads {
    return {
      items: [],
      attachments: [],
      uploading: false,
      add: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      ...overrides,
    };
  }

  function renderComposer(uploads?: Uploads) {
    const onSend = vi.fn();
    render(
      <TooltipProvider>
        <Composer agents={['moderator']} onSend={onSend} uploads={uploads} />
      </TooltipProvider>,
    );
    return { onSend, textbox: screen.getByRole<HTMLTextAreaElement>('textbox') };
  }

  it('offers no attaching without uploads', () => {
    renderComposer();
    expect(screen.queryByRole('button', { name: 'Datei anhängen' })).not.toBeInTheDocument();
  });

  it('attaches chosen and pasted files', () => {
    const uploads = uploadsWith();
    const { textbox } = renderComposer(uploads);
    const picker = screen.getByLabelText<HTMLInputElement>('Dateien auswählen');
    expect(picker).toHaveAttribute('multiple');
    expect(picker.accept).toContain('application/pdf');
    expect(screen.getByRole('button', { name: 'Datei anhängen' })).toBeEnabled();

    const chosen = file('Notizen.md');
    fireEvent.change(picker, { target: { files: [chosen] } });
    expect(uploads.add).toHaveBeenCalledWith([chosen]);

    const pasted = file('screenshot.png');
    fireEvent.paste(textbox, { clipboardData: { files: [pasted] } });
    expect(uploads.add).toHaveBeenLastCalledWith([pasted]);
    // Pasting text stays what it was.
    fireEvent.paste(textbox, { clipboardData: { files: [] } });
    expect(uploads.add).toHaveBeenCalledTimes(2);
  });

  it('shows the files as chips and takes them off again', () => {
    const uploads = uploadsWith({
      items: [
        { localId: 'a', name: 'skizze.png', sizeBytes: 340_200, status: 'done', attachment: IMAGE },
        { localId: 'b', name: 'Notizen.md', sizeBytes: 2_400_000, status: 'uploading' },
      ],
      attachments: [IMAGE],
      uploading: true,
    });
    renderComposer(uploads);

    const chips = within(screen.getByRole('list', { name: 'Angehängte Dateien' })).getAllByRole(
      'listitem',
    );
    expect(chips[0]).toHaveTextContent('skizze.png340 kB');
    expect(chips[1]).toHaveTextContent('Notizen.md2,4 MB');
    expect(within(chips[1] as HTMLElement).getByLabelText('Wird hochgeladen')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'skizze.png entfernen' }));
    expect(uploads.remove).toHaveBeenCalledWith('a');
  });

  it('waits for the uploads, then sends the text with the files', () => {
    const waiting = uploadsWith({ uploading: true });
    const first = renderComposer(waiting);
    fireEvent.change(first.textbox, { target: { value: 'Schaut mal' } });
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    fireEvent.keyDown(first.textbox, { key: 'Enter' });
    expect(first.onSend).not.toHaveBeenCalled();
  });

  it('sends the uploaded files along and forgets them', () => {
    const uploads = uploadsWith({ attachments: [IMAGE, NOTES] });
    const { onSend, textbox } = renderComposer(uploads);

    // Files alone are not a message yet.
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    fireEvent.change(textbox, { target: { value: ' Schaut mal ' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });

    // No element of the canvas was asked about (spec 37b).
    expect(onSend).toHaveBeenCalledWith('Schaut mal', [IMAGE, NOTES], []);
    expect(uploads.clear).toHaveBeenCalledOnce();
    expect(textbox).toHaveValue('');
  });
});

describe('attachments of a message', () => {
  it('show images as thumbnails and files as chips that download', () => {
    render(<AttachmentList projectId={PROJECT} attachments={[IMAGE, NOTES]} />);

    const image = screen.getByRole('img', { name: 'skizze.png' });
    expect(image).toHaveAttribute('src', `/api/projects/${PROJECT}/files/${IMAGE.id}`);
    const open = screen.getByRole('link', { name: 'skizze.png öffnen' });
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noreferrer');

    const chip = screen.getByRole('link', { name: 'Notizen.md herunterladen' });
    expect(chip).toHaveAttribute('href', `/api/projects/${PROJECT}/files/${NOTES.id}`);
    expect(chip).toHaveAttribute('download', 'Notizen.md');
    expect(chip).toHaveTextContent('Notizen.md2,4 MB');
  });

  it('render nothing without files', () => {
    const { container } = render(<AttachmentList projectId={PROJECT} attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('are part of the message in the chat', () => {
    const createdAt = new Date(2026, 9, 1, 14, 5).toISOString();
    render(
      <ChatMessageView
        item={{
          id: 'message-1',
          projectId: PROJECT,
          author: { kind: 'human', userId: 'user-olga', name: 'Olga' },
          content: 'Schaut mal',
          mentions: [],
          replyTo: null,
          status: 'complete',
          attachments: [IMAGE, NOTES],
          createdAt,
          updatedAt: createdAt,
        }}
        isOwn={false}
      />,
    );

    const article = screen.getByRole('article');
    expect(within(article).getByRole('img', { name: 'skizze.png' })).toBeInTheDocument();
    expect(
      within(article).getByRole('link', { name: 'Notizen.md herunterladen' }),
    ).toBeInTheDocument();
  });
});
