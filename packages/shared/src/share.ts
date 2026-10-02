import { z } from 'zod';

import type { CustomAgentSummary } from './agents/custom';
import type { CanvasEdge, CanvasNode } from './canvas/model';
import type { Criterion, Decision } from './decisions';
import { invitationTokenSchema } from './invitations';
import type { ProjectBoard } from './projects';

// The read-only link of a project (spec 21b): it shows the canvas and the overview to people
// without an account, never the chat and never a person.

/**
 * Stands in for every person in the read-only view: elements people made keep that a person made
 * them, but not who.
 */
export const NO_USER_ID = '00000000-0000-4000-8000-000000000000';

/** `GET /api/projects/:projectId/share-link`: whether the project has a link, and since when. */
export type ShareLinkStatus = { active: boolean; createdAt: string | null };

/** A new link: `url` is shown this once, since only its hash is stored. */
export type CreatedShareLink = { url: string; createdAt: string };

/** `POST /api/share/view`: the token from the link. */
export const shareViewInputSchema = z.object({ token: invitationTokenSchema });

/** `POST /api/share/board`: the token and the board to show. */
export const shareBoardInputSchema = z.object({ token: invitationTokenSchema, boardId: z.uuid() });

/** What the read-only view shows besides the boards' content. */
export type SharedProject = {
  name: string;
  /** Ordered by position, the main board first. */
  boards: ProjectBoard[];
  /** Without who confirmed them. */
  decisions: Decision[];
  criteria: Criterion[];
  /** Name and color of the custom agents the canvas names; never their creator. */
  customAgents: CustomAgentSummary[];
};

/** The content of one board, with every person replaced by `NO_USER_ID`. */
export type SharedBoard = { nodes: CanvasNode[]; edges: CanvasEdge[] };
