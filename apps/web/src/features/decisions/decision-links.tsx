import { sameDecisionTarget, type DecisionLinkTarget } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Dialog, DialogContent } from '@web/components/ui/dialog';
import { Input, Label } from '@web/components/ui/input';
import {
  decisionLinksQuery,
  decisionLinkTargetsQuery,
  useDecisionLinkActions,
} from '@web/features/decisions/link-queries';
import { decisionsQuery } from '@web/features/decisions/queries';

export type OpenDecisionTarget = (target: DecisionLinkTarget) => void;

type ReviewProps = {
  projectId: string;
  decisionId: string;
  readOnly: boolean;
  onOpenTarget?: OpenDecisionTarget;
};

/** Direct dependencies are a review checklist, not a prediction that a target will break. */
export function DecisionLinksReview({
  projectId,
  decisionId,
  readOnly,
  onOpenTarget,
}: ReviewProps) {
  const { t } = useTranslation();
  const query = useQuery(decisionLinksQuery(projectId));
  const actions = useDecisionLinkActions(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const searchId = useId();
  const candidates = useQuery({ ...decisionLinkTargetsQuery(projectId, search), enabled: editing });
  const links = query.data?.filter((link) => link.decisionId === decisionId) ?? [];
  const busy = actions.add.isPending || actions.remove.isPending;
  return (
    <section
      aria-label={t('decisionLinks.impact')}
      className="flex flex-col gap-2 border-t border-border-subtle pt-3"
    >
      <h3 className="m-0 text-ui font-semibold text-text">{t('decisionLinks.impact')}</h3>
      <p className="m-0 text-small text-text-3">{t('decisionLinks.reviewHint')}</p>
      {query.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : query.isError ? (
        <Button onClick={() => void query.refetch()}>{t('decisionLinks.retry')}</Button>
      ) : links.length === 0 ? (
        <p className="m-0 text-small text-text-3">{t('decisionLinks.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {links.map((link) => (
            <li key={link.id} className="flex items-start gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <Button
                  size="s"
                  disabled={!link.available || !onOpenTarget}
                  onClick={() => onOpenTarget?.(link.target)}
                >
                  {t(`decisionLinks.${link.target.kind}`)}: {link.label}
                  {link.available ? '' : ` · ${t('decisionLinks.missing')}`}
                </Button>
                {link.context ? (
                  <span className="text-small text-text-3">{link.context}</span>
                ) : null}
              </div>
              {!readOnly ? (
                <Button
                  size="s"
                  disabled={busy}
                  aria-label={t('decisionLinks.removeNamed', { name: link.label })}
                  onClick={() => {
                    actions.remove.mutate(link.id);
                  }}
                >
                  {t('decisionLinks.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!readOnly ? (
        <>
          <Button
            size="s"
            onClick={() => {
              setEditing(!editing);
            }}
          >
            {t('decisionLinks.addTarget')}
          </Button>
          {editing ? (
            <div className="flex flex-col gap-2">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(draft.trim());
                }}
              >
                <div className="min-w-0 flex-1">
                  <Label htmlFor={searchId}>{t('decisionLinks.searchTargets')}</Label>
                  <Input
                    id={searchId}
                    value={draft}
                    maxLength={200}
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                  />
                </div>
                <Button type="submit" size="s">
                  {t('decisionLinks.search')}
                </Button>
              </form>
              {candidates.isPending ? (
                <p role="status">{t('common.loading')}</p>
              ) : candidates.isError ? (
                <Button onClick={() => void candidates.refetch()}>
                  {t('decisionLinks.retry')}
                </Button>
              ) : (
                <>
                  <ul className="m-0 flex max-h-52 list-none flex-col gap-1 overflow-auto p-0">
                    {candidates.data.targets.map((candidate) => (
                      <li key={JSON.stringify(candidate.target)}>
                        <Button
                          size="s"
                          disabled={
                            busy ||
                            links.some((link) => sameDecisionTarget(link.target, candidate.target))
                          }
                          onClick={() => {
                            actions.add.mutate({ decisionId, target: candidate.target });
                          }}
                        >
                          {t(`decisionLinks.${candidate.target.kind}`)}: {candidate.label} ·{' '}
                          {candidate.context}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {candidates.data.targets.length === 0 ? (
                    <p>{t('decisionLinks.noTargets')}</p>
                  ) : null}
                  {candidates.data.more ? (
                    <p className="m-0 text-small text-text-3">{t('decisionLinks.refineSearch')}</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      {actions.add.isError || actions.remove.isError ? (
        <p role="alert">{t('decisionLinks.failed')}</p>
      ) : null}
    </section>
  );
}

type TargetProps = {
  projectId: string;
  target: DecisionLinkTarget;
  readOnly: boolean;
  onOpenDecision: (id: string) => void;
};

export function TargetDecisionLinks(props: TargetProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="s"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('decisionLinks.behindThis')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent
            title={t('decisionLinks.behindThis')}
            className="w-[min(480px,calc(100vw-32px))]"
          >
            <TargetDecisionLinksContent
              {...props}
              onNavigate={(id) => {
                setOpen(false);
                props.onOpenDecision(id);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function TargetDecisionLinksContent({
  projectId,
  target,
  readOnly,
  onNavigate,
}: Omit<TargetProps, 'onOpenDecision'> & { onNavigate: (id: string) => void }) {
  const { t } = useTranslation();
  const query = useQuery(decisionLinksQuery(projectId));
  const decisions = useQuery(decisionsQuery(projectId));
  const actions = useDecisionLinkActions(projectId);
  const links = query.data?.filter((link) => sameDecisionTarget(link.target, target)) ?? [];
  const busy = actions.add.isPending || actions.remove.isPending;
  return (
    <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
      {query.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : query.isError ? (
        <Button onClick={() => void query.refetch()}>{t('decisionLinks.retry')}</Button>
      ) : links.length === 0 ? (
        <p>{t('decisionLinks.noDecisions')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {links.map((link) => (
            <li key={link.id} className="flex gap-2">
              <Button
                size="s"
                onClick={() => {
                  onNavigate(link.decisionId);
                }}
              >
                {link.topic} · {t(`decisionLinks.${link.status}`)}
              </Button>
              {!readOnly ? (
                <Button
                  size="s"
                  disabled={busy}
                  onClick={() => {
                    actions.remove.mutate(link.id);
                  }}
                  aria-label={t('decisionLinks.removeNamed', { name: link.topic })}
                >
                  {t('decisionLinks.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!readOnly ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-ui font-semibold text-text">{t('decisionLinks.addDecision')}</h3>
          {decisions.isPending ? (
            <p role="status">{t('common.loading')}</p>
          ) : decisions.isError ? (
            <Button onClick={() => void decisions.refetch()}>{t('decisionLinks.retry')}</Button>
          ) : (
            decisions.data.map((decision) => (
              <Button
                key={decision.id}
                size="s"
                disabled={busy || links.some((link) => link.decisionId === decision.id)}
                onClick={() => {
                  actions.add.mutate({ decisionId: decision.id, target });
                }}
              >
                {decision.topic}
              </Button>
            ))
          )}
        </div>
      ) : null}
      {actions.add.isError || actions.remove.isError ? (
        <p role="alert">{t('decisionLinks.failed')}</p>
      ) : null}
    </div>
  );
}
