import { planNodesFromMarkdown } from '@covibes/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob, downloadText } from '@web/features/export/download';
import { ExportMenu } from '@web/features/export/export-menu';
import { PlanExportMenu } from '@web/features/export/plan-export-menu';
import { planPdf } from '@web/features/export/plan-pdf';

// The browser's downloads and the PDF library are replaced; what goes into them is checked.
vi.mock('@web/features/export/download', () => ({
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
}));
vi.mock('@web/features/export/plan-pdf', () => ({
  planPdf: vi.fn(() => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' }))),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** Opens the menu of formats and returns its entries. */
async function openMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Exportieren' }), {
    button: 0,
    ctrlKey: false,
  });
  const menu = await screen.findByRole('menu');
  return menu;
}

describe('ExportMenu', () => {
  it('lists the formats and runs the one chosen', async () => {
    const png = vi.fn();
    const svg = vi.fn();
    render(
      <ExportMenu
        className="grid"
        onFailed={vi.fn()}
        options={[
          { key: 'png', label: 'Als Bild (PNG)', run: png },
          { key: 'svg', label: 'Als Vektorgrafik (SVG)', run: svg },
        ]}
      />,
    );

    await openMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Als Bild (PNG)',
      'Als Vektorgrafik (SVG)',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Als Vektorgrafik (SVG)' }));

    await waitFor(() => {
      expect(svg).toHaveBeenCalledTimes(1);
    });
    expect(png).not.toHaveBeenCalled();
  });

  it('rests while a file is made, and says so when none came', async () => {
    let fail: (reason: Error) => void = () => undefined;
    const onFailed = vi.fn();
    render(
      <ExportMenu
        className="grid"
        onFailed={onFailed}
        options={[
          {
            key: 'pdf',
            label: 'Als PDF',
            run: () =>
              new Promise<void>((_, reject) => {
                fail = reject;
              }),
          },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Exportieren' });

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Als PDF' }));
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    fail(new Error('The board could not be drawn'));
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});

describe('PlanExportMenu', () => {
  const nodes = planNodesFromMarkdown('### Meilenstein 1: Grundgerüst\n\n- Login bauen');

  function renderMenu(language: 'de' | 'en' = 'de') {
    const onFailed = vi.fn();
    render(
      <PlanExportMenu
        projectName="Vereins-App"
        language={language}
        nodes={nodes}
        assignees={new Map()}
        onFailed={onFailed}
      />,
    );
    return onFailed;
  }

  it('downloads the plan as Markdown, named after the project', async () => {
    renderMenu();

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Als Markdown' }));

    await waitFor(() => {
      expect(downloadText).toHaveBeenCalledTimes(1);
    });
    expect(downloadText).toHaveBeenCalledWith(
      '# Projektplan: Vereins-App\n\n### Meilenstein 1: Grundgerüst\n\n- Login bauen\n',
      'vereins-app-projektplan.md',
    );
  });

  it('downloads the plan as PDF, with the date in the language of the project', async () => {
    renderMenu('en');

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Als PDF' }));

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'vereins-app-project-plan.pdf');
    const [plan] = vi.mocked(planPdf).mock.calls[0] ?? [];
    expect(plan).toMatchObject({ projectName: 'Vereins-App', language: 'en', nodes });
    // "October 3, 2026", whatever the day is.
    expect(plan?.date).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it('tells when the PDF could not be made', async () => {
    vi.mocked(planPdf).mockRejectedValueOnce(new Error('No font'));
    const onFailed = renderMenu();

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Als PDF' }));

    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
