import { createHash } from 'node:crypto';

import { readPlanSections, readRoadmap } from '@covibes/shared';
import type * as Y from 'yjs';

import type { LivePublisher } from '@server/realtime/realtime';

/** Projects whose last roadmap is remembered; beyond that, the one announced longest ago leaves. */
const REMEMBERED_PROJECTS = 2000;

/**
 * Announces on a project's live channel that its roadmap changed (spec 26a), for the collaboration
 * server to call whenever it stored a plan. Most stores change other sections or nothing the
 * roadmap shows, so it compares with the roadmap it saw last for the project and stays quiet while
 * that is the same. The first plan it sees of a project is announced, since it knows no earlier
 * one. It remembers a fingerprint per project, not the roadmap, and only of so many projects; a
 * forgotten project is announced once more, which costs its clients one request.
 */
export function createRoadmapAnnouncer(live: LivePublisher, remembered = REMEMBERED_PROJECTS) {
  const lastSeen = new Map<string, string>();
  return (projectId: string, doc: Y.Doc) => {
    const roadmap = createHash('sha256')
      .update(JSON.stringify(readRoadmap(readPlanSections(doc))))
      .digest('base64');
    if (lastSeen.get(projectId) === roadmap) return;
    // A map keeps the order of insertion: the project announced last moves to the end.
    lastSeen.delete(projectId);
    lastSeen.set(projectId, roadmap);
    if (lastSeen.size > remembered) {
      const [oldest] = lastSeen.keys();
      if (oldest !== undefined) lastSeen.delete(oldest);
    }
    live.publish(projectId, { type: 'roadmap' });
  };
}
