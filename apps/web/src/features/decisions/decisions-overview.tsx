import type { Criterion, Decision } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CriteriaSection } from '@web/features/decisions/criteria-section';
import { DecisionsSection } from '@web/features/decisions/decisions-section';
import {
  criteriaQuery,
  decisionLogQuery,
  decisionsQuery,
  useCriteriaMutations,
  useReopenDecision,
} from '@web/features/decisions/queries';

type DecisionsOverviewProps = {
  projectId: string;
  /** Topics (lowercase) whose variants wait for the team (spec 17). */
  comparing: readonly string[];
  /** Viewers see decisions and criteria but change nothing. */
  readOnly: boolean;
  /** Shows a short note, e.g. when a change failed. */
  onNotice: (text: string) => void;
  /** The decision whose dialog is open; "Seit du weg warst" opens decisions too (spec 23). */
  openDecisionId: string | null;
  onOpenDecision: (decisionId: string | null) => void;
};

const NO_DECISIONS: Decision[] = [];
const NO_CRITERIA: Criterion[] = [];

/**
 * The overview sections "Entscheidungen" and "Kriterien" of a project (spec 16a) with their data:
 * both load with the project and follow the live channel; the log loads once its dialog opens.
 */
export function DecisionsOverview({
  projectId,
  comparing,
  readOnly,
  onNotice,
  openDecisionId,
  onOpenDecision,
}: DecisionsOverviewProps) {
  const { t } = useTranslation();
  const decisions = useQuery(decisionsQuery(projectId)).data ?? NO_DECISIONS;
  const criteria = useQuery(criteriaQuery(projectId)).data ?? NO_CRITERIA;
  const [logWanted, setLogWanted] = useState(false);
  const log = useQuery({ ...decisionLogQuery(projectId), enabled: logWanted }).data;
  const reopen = useReopenDecision(projectId);
  const { add, change, remove } = useCriteriaMutations(projectId, (reason) => {
    onNotice(t(reason === 'limit_reached' ? 'criteria.limitReached' : 'criteria.failed'));
  });

  return (
    <>
      <DecisionsSection
        decisions={decisions}
        comparing={comparing}
        openId={openDecisionId}
        onOpenIdChange={onOpenDecision}
        log={log}
        onOpenLog={() => {
          setLogWanted(true);
        }}
        onReopen={
          readOnly
            ? undefined
            : (decision, reason) => {
                reopen.mutate(
                  { decisionId: decision.id, reason },
                  {
                    onError: () => {
                      onNotice(t('decisions.reopenFailed'));
                    },
                  },
                );
              }
        }
      />
      <CriteriaSection
        criteria={criteria}
        edit={
          readOnly
            ? undefined
            : {
                onAdd: (text) => {
                  add.mutate(text);
                },
                onChange: (criterion) => {
                  change.mutate(criterion);
                },
                onRemove: (id) => {
                  remove.mutate(id);
                },
              }
        }
      />
    </>
  );
}
