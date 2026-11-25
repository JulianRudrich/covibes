import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@web/components/ui/tooltip';
import { CanvasToolbar } from '@web/features/canvas/canvas-toolbar';
import { PlacementLayer } from '@web/features/canvas/placement-layer';
import { nextZoom } from '@web/features/canvas/zoom';

function withFlow({ children }: { children: ReactNode }) {
  return (
    <ReactFlowProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </ReactFlowProvider>
  );
}

describe('nextZoom', () => {
  it('goes in steps of 10 %', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.2000000001, 1)).toBe(1.3);
  });

  it('goes from between two steps to the next one in that direction', () => {
    expect(nextZoom(0.66, 1)).toBe(0.7);
    expect(nextZoom(0.66, -1)).toBe(0.6);
  });

  it('allows large-board fits below one percent and caps zoom at 200 %', () => {
    expect(nextZoom(2, 1)).toBe(2);
    expect(nextZoom(1.95, 1)).toBe(2);
    expect(nextZoom(0.3, -1)).toBe(0.2);
    expect(nextZoom(0.001, -1)).toBe(0.001);
  });
});

describe('CanvasToolbar', () => {
  function renderToolbar(props: Partial<Parameters<typeof CanvasToolbar>[0]> = {}) {
    const handlers = { onToolChange: vi.fn(), onAutoLayout: vi.fn() };
    render(
      <CanvasToolbar tool={null} layoutBusy={false} readOnly={false} {...handlers} {...props} />,
      { wrapper: withFlow },
    );
    return handlers;
  }

  it('offers the tools of the handoff and the zoom', () => {
    renderToolbar();

    const toolbar = screen.getByRole('toolbar', { name: 'Werkzeuge' });
    expect(toolbar).toHaveClass('bottom-4', 'rounded-full', 'bg-bg-panel', 'shadow-float');
    expect(screen.getAllByRole('button').map((button) => button.ariaLabel)).toEqual([
      'Auswählen',
      'Block',
      'Notiz',
      'Rahmen',
      'Verbinden',
      'Auto-Layout',
      'Alles anzeigen',
      'Verkleinern',
      'Vergrößern',
    ]);
    expect(screen.getByText('100 %')).toHaveClass('tabular-nums');
  });

  it('turns a tool on and off again, one at a time', () => {
    const { onToolChange } = renderToolbar({ tool: 'note' });

    expect(screen.getByRole('button', { name: 'Notiz' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Notiz' })).toHaveClass('bg-ink', 'text-on-ink');
    expect(screen.getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Auswählen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(onToolChange).toHaveBeenLastCalledWith('block');
    fireEvent.click(screen.getByRole('button', { name: 'Notiz' }));
    expect(onToolChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));
    expect(onToolChange).toHaveBeenLastCalledWith(null);
  });

  it('presses "Auswählen" while no other tool is (spec 36b)', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Auswählen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('runs the auto-layout as an action, not a mode', () => {
    const { onAutoLayout, onToolChange } = renderToolbar();

    const autoLayout = screen.getByRole('button', { name: 'Auto-Layout' });
    expect(autoLayout).not.toHaveAttribute('aria-pressed');
    fireEvent.click(autoLayout);

    expect(onAutoLayout).toHaveBeenCalledOnce();
    expect(onToolChange).not.toHaveBeenCalled();
  });

  it('gives viewers show-all and zoom navigation', () => {
    renderToolbar({ readOnly: true });

    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alles anzeigen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vergrößern' })).toBeInTheDocument();
  });

  it('shows what stands at its end after the zoom, also for viewers (spec 27a)', () => {
    renderToolbar({ readOnly: true, end: <button type="button">Exportieren</button> });

    expect(
      screen.getAllByRole('button').map((button) => button.ariaLabel ?? button.textContent),
    ).toEqual(['Alles anzeigen', 'Verkleinern', 'Vergrößern', 'Exportieren']);
  });
});

describe('PlacementLayer', () => {
  function renderLayer(drawsArea: boolean) {
    const onPlace = vi.fn();
    render(<PlacementLayer drawsArea={drawsArea} onPlace={onPlace} />, { wrapper: withFlow });
    const layer = screen.getByTestId('placement-layer');
    layer.setPointerCapture = vi.fn();
    return { layer, onPlace };
  }

  it('places at a click', () => {
    const { layer, onPlace } = renderLayer(false);

    fireEvent.pointerDown(layer, { button: 0, clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 102, clientY: 81, pointerId: 1 });

    expect(onPlace).toHaveBeenCalledWith({ kind: 'point', at: { x: 102, y: 81 } });
  });

  it('draws an area for a frame, in any direction', () => {
    const { layer, onPlace } = renderLayer(true);

    fireEvent.pointerDown(layer, { button: 0, clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 100, clientY: 50, pointerId: 1 });

    expect(onPlace).toHaveBeenCalledWith({
      kind: 'area',
      from: { x: 100, y: 50 },
      to: { x: 300, y: 200 },
    });
  });

  it('counts a drag without a frame tool as a click', () => {
    const { layer, onPlace } = renderLayer(false);

    fireEvent.pointerDown(layer, { button: 0, clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 100, clientY: 50, pointerId: 1 });

    expect(onPlace).toHaveBeenCalledWith({ kind: 'point', at: { x: 100, y: 50 } });
  });
});
