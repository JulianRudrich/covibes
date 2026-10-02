import {
  PLAN_FIELD,
  readPlan,
  readPlanSections,
  type PlanNode,
  type PlanSection,
} from '@covibes/shared';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

export type PlanText = {
  /** The whole plan as nodes. */
  nodes: PlanNode[];
  /** What every section holds below its heading. */
  sections: Partial<Record<PlanSection, PlanNode[]>>;
};

/** Typing changes the plan many times a second; the comparisons follow a moment later. */
const SETTLE_MS = 200;

function read(doc: Y.Doc): PlanText {
  return { nodes: readPlan(doc), sections: readPlanSections(doc) };
}

/**
 * The plan as it stands in the shared document (spec 25c), for comparing a suggestion or a
 * version with it. It follows every change, by oneself and by others.
 */
export function usePlanText(doc: Y.Doc): PlanText {
  const [text, setText] = useState(() => read(doc));
  useEffect(() => {
    setText(read(doc));
    const fragment = doc.getXmlFragment(PLAN_FIELD);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setText(read(doc));
      }, SETTLE_MS);
    };
    fragment.observeDeep(changed);
    return () => {
      clearTimeout(timer);
      fragment.unobserveDeep(changed);
    };
  }, [doc]);
  return text;
}
