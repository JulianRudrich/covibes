import type { Variant } from '@covibes/shared';

const FRAME_A = 'a1111111-1111-4111-8111-111111111111';
const APP = 'a2222222-2222-4222-8222-222222222222';
const DATABASE = 'a3333333-3333-4333-8333-333333333333';
const FRAME_B = 'b1111111-1111-4111-8111-111111111111';
const GATEWAY = 'b2222222-2222-4222-8222-222222222222';

/** Two variants of an architecture as `propose_variants` draws them (spec 17). */
export const VARIANTS: Variant[] = [
  {
    name: 'Monolith',
    summary: 'Ein Deployment, wenig Betrieb.',
    operations: [
      {
        op: 'add_frame',
        frame: {
          id: FRAME_A,
          position: { x: 0, y: 0 },
          title: 'Architektur: Monolith',
          size: { width: 480, height: 280 },
          diagramType: 'architecture',
        },
        members: [APP, DATABASE],
      },
      {
        op: 'add_block',
        block: {
          id: APP,
          position: { x: 40, y: 80 },
          label: 'App',
          subtitle: '',
          blockType: 'service',
          fields: [],
          frameId: FRAME_A,
        },
      },
      {
        op: 'add_block',
        block: {
          id: DATABASE,
          position: { x: 280, y: 80 },
          label: 'Datenbank',
          subtitle: '',
          blockType: 'database',
          fields: [],
          frameId: FRAME_A,
        },
      },
      { op: 'add_edge', edge: { id: 'a-edge', source: APP, target: DATABASE, label: '' } },
    ],
  },
  {
    name: 'Microservices',
    summary: '',
    operations: [
      {
        op: 'add_frame',
        frame: {
          id: FRAME_B,
          position: { x: 560, y: 0 },
          title: 'Architektur: Microservices',
          size: { width: 300, height: 280 },
          diagramType: 'architecture',
        },
        members: [GATEWAY],
      },
      {
        op: 'add_block',
        block: {
          id: GATEWAY,
          position: { x: 600, y: 80 },
          label: 'Gateway',
          subtitle: '',
          blockType: 'service',
          fields: [],
          frameId: FRAME_B,
        },
      },
    ],
  },
];
