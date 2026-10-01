import { variantLetter, type Proposal } from '@covibes/shared';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, agentColor, useAgents } from '@web/features/agents/agents';
import {
  AGENT_DARK_TEXT,
  AGENT_PROPOSAL,
  AGENT_TILE,
  AGENT_LABEL,
  AGENT_BACKGROUND,
} from '@web/features/canvas/agent-look';
import { arrowGeometries, type Rect } from '@web/features/canvas/arrow-geometry';
import { blockIcon } from '@web/features/canvas/block-types';
import type { ProposalOverlay, GhostElement } from '@web/features/proposals/proposal-overlay';
import type { DecideProposal } from '@web/features/proposals/queries';
import { cn } from '@web/lib/cn';

type ProposalLayerProps = {
  overlay: ProposalOverlay;
  /** Where the elements on the board are right now. */
  rects: ReadonlyMap<string, Rect>;
  proposals: ReadonlyMap<string, Proposal>;
  /** Owners and editors decide; viewers only see proposals. */
  canDecide: boolean;
  /** Whether the user adopts variants; false for editors while the owner decides (spec 16b). */
  canAdoptVariants?: boolean;
  onDecide: DecideProposal;
};

/** Room between an existing element and the dashed outline of a change proposed for it. */
const OUTLINE_GAP = 4;

/**
 * The open proposals of the board in flow coordinates (spec 13, handoff state "Proposal"): new
 * elements as dashed cards in the agent's tint, new arrows dashed without head, and a dashed
 * outline with the pill "Vorschlag" around elements a proposal changes or moves. They lie above
 * the board and cannot be moved; the first new element carries "Übernehmen" and "Verwerfen".
 */
export function ProposalLayer({
  overlay,
  rects,
  proposals,
  canDecide,
  canAdoptVariants = canDecide,
  onDecide,
}: ProposalLayerProps) {
  const { t } = useTranslation();
  const agents = useAgents();
  const allRects = new Map(rects);
  for (const element of overlay.elements) {
    allRects.set(element.id, { ...element.position, ...element.size });
  }
  const geometries = arrowGeometries(overlay.arrows, allRects);

  return (
    <>
      <svg
        className="pointer-events-none absolute top-0 left-0 z-[4] overflow-visible"
        width="1"
        height="1"
        aria-hidden="true"
      >
        {overlay.arrows.map((arrow) => {
          const geometry = geometries.get(arrow.id);
          return geometry ? (
            <path
              key={arrow.id}
              d={geometry.path}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              style={{ stroke: agentColor(agents(arrow.agentKey)) }}
              data-testid="proposal-arrow"
            />
          ) : null;
        })}
      </svg>
      {overlay.arrows.map((arrow) => {
        const geometry = geometries.get(arrow.id);
        return geometry && arrow.label ? (
          <span
            key={`${arrow.id}-label`}
            className={cn(
              'pointer-events-none absolute top-0 left-0 z-[4] flex h-5 items-center rounded-sm border px-[7px] font-mono text-badge whitespace-nowrap',
              agentClass(AGENT_LABEL, agents(arrow.agentKey)),
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${String(geometry.label.x)}px, ${String(geometry.label.y)}px)`,
            }}
          >
            {arrow.label}
          </span>
        ) : null;
      })}

      {[...overlay.changed].map(([id, agentKey]) => {
        const rect = rects.get(id);
        return rect ? (
          <div
            key={`${id}-changed`}
            className={cn(
              'pointer-events-none absolute top-0 left-0 z-[4] rounded-[14px] border-[1.5px] border-dashed',
              agentClass(AGENT_PROPOSAL, agents(agentKey)),
              'bg-transparent',
            )}
            style={{
              transform: `translate(${String(rect.x - OUTLINE_GAP)}px, ${String(rect.y - OUTLINE_GAP)}px)`,
              width: rect.width + 2 * OUTLINE_GAP,
              height: rect.height + 2 * OUTLINE_GAP,
            }}
            data-testid="proposal-changed"
          >
            <span
              className={cn(
                'absolute -top-[27px] -right-[1.5px] flex h-[22px] items-center rounded-sm px-2 text-meta font-medium whitespace-nowrap text-on-ink',
                agentClass(AGENT_BACKGROUND, agents(agentKey)),
              )}
            >
              {t('proposals.marker')}
            </span>
          </div>
        ) : null;
      })}

      {overlay.elements.map((element) => {
        const proposal = proposals.get(element.proposalId);
        return (
          <GhostCard
            key={element.id}
            element={element}
            actions={
              element.anchor && element.variant && proposal ? (
                // A variant is adopted as a whole; all of them are rejected in the overview.
                canAdoptVariants ? (
                  <Button
                    variant="primary"
                    size="s"
                    onClick={() => {
                      onDecide(proposal, 'apply', element.variant?.position);
                    }}
                  >
                    {t('proposals.apply')}
                  </Button>
                ) : null
              ) : element.anchor && canDecide && proposal ? (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="s"
                    onClick={() => {
                      onDecide(proposal, 'apply');
                    }}
                  >
                    {t('proposals.apply')}
                  </Button>
                  <Button
                    size="s"
                    onClick={() => {
                      onDecide(proposal, 'reject');
                    }}
                  >
                    {t('proposals.reject')}
                  </Button>
                </div>
              ) : null
            }
          />
        );
      })}
    </>
  );
}

function ProposalHeader({
  agentKey,
  variant,
}: {
  agentKey: string;
  variant: GhostElement['variant'];
}) {
  const { t } = useTranslation();
  const agent = useAgents()(agentKey);
  const { name } = agent;
  return (
    <div className="flex h-4 shrink-0 items-center gap-1.5 text-meta">
      <AgentAvatar agent={agent} size={16} />
      <span className={cn('truncate font-medium', agentClass(AGENT_DARK_TEXT, agent))}>
        {variant
          ? t('variants.letter', { letter: variantLetter(variant.position) })
          : t('proposals.header', { agent: name })}
      </span>
    </div>
  );
}

/** "Variante A · Monolith" above the frame of a variant (spec 17). */
function VariantHeading({
  agentKey,
  variant,
}: {
  agentKey: string;
  variant: NonNullable<GhostElement['variant']>;
}) {
  const { t } = useTranslation();
  const agent = useAgents()(agentKey);
  return (
    <div className="absolute bottom-full left-0 flex w-full items-start gap-2 pb-2">
      <AgentAvatar agent={agent} size={16} className="mt-0.5" />
      <span className="min-w-0 text-ui leading-snug font-semibold break-words text-text">
        {t('variants.title', { letter: variantLetter(variant.position), name: variant.name })}
      </span>
    </div>
  );
}

/** One proposed element: a block, a note or a frame. */
function GhostCard({ element, actions }: { element: GhostElement; actions: React.ReactNode }) {
  const agent = useAgents()(element.agentKey);
  const Icon = blockIcon(element.blockType);
  const place = {
    transform: `translate(${String(element.position.x)}px, ${String(element.position.y)}px)`,
    width: element.size.width,
    height: element.size.height,
  };
  const frame = cn(
    'nodrag nopan pointer-events-auto absolute top-0 left-0 border-[1.5px] border-dashed',
    agentClass(AGENT_PROPOSAL, agent),
  );

  if (element.kind === 'frame') {
    return (
      <div
        className={cn(frame, 'z-[4] rounded-frame p-3.5 !bg-transparent')}
        style={place}
        data-testid="proposal-element"
      >
        {element.variant ? (
          <>
            {/* A variant is headed above its frame, where a long name has room to wrap. */}
            <VariantHeading agentKey={element.agentKey} variant={element.variant} />
            <div className="flex justify-end">{actions}</div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <ProposalHeader agentKey={element.agentKey} variant={null} />
            <span className="min-w-0 truncate text-ui font-semibold text-text">
              {element.label}
            </span>
            <div className="ml-auto">{actions}</div>
          </div>
        )}
      </div>
    );
  }

  if (element.kind === 'note') {
    return (
      <div
        className={cn(frame, 'z-[5] flex flex-col gap-2 rounded-[4px_4px_14px_4px] p-3.5')}
        style={place}
        data-testid="proposal-element"
      >
        <ProposalHeader agentKey={element.agentKey} variant={element.variant} />
        <div className="line-clamp-3 min-h-0 flex-1 text-body leading-snug font-semibold break-words text-note-text">
          {element.label}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div
      className={cn(frame, 'z-[5] flex flex-col gap-2.5 rounded-panel p-3')}
      style={place}
      data-testid="proposal-element"
    >
      <ProposalHeader agentKey={element.agentKey} variant={element.variant} />
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-md border border-dashed',
            agentClass(AGENT_TILE, agent),
          )}
        >
          <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-body leading-snug font-semibold text-text">
            {element.label}
          </div>
          {element.subtitle ? (
            <div className="truncate text-meta text-text-3">{element.subtitle}</div>
          ) : null}
        </div>
      </div>
      {actions}
    </div>
  );
}
