// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

/** A deterministic grid world. Only position is supplied to the tabular policy. */
export interface GridPosition {
  x: number;
  y: number;
}
export const RL_WIDTH = 7;
export const RL_HEIGHT = 5;
export const RL_ACTIONS = ["up", "right", "down", "left"] as const;
export type ReinforcementAction = (typeof RL_ACTIONS)[number];
export type RewardPreset = "goal" | "bonus";
export const RL_STARTS: readonly GridPosition[] = [
  { x: 0, y: 0 },
  { x: 0, y: 2 },
  { x: 0, y: 4 },
];
export const RL_GOAL: GridPosition = { x: 6, y: 2 };
export const RL_BONUS: GridPosition = { x: 1, y: 1 };
export const RL_WALLS: readonly GridPosition[] = [
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 3, y: 3 },
  { x: 3, y: 4 },
];
export const RL_EPISODES = 600;
export const RL_MAX_STEPS = 80;
export const RL_ALPHA = 0.22;
export const RL_GAMMA = 0.95;

export interface RewardBreakdown {
  step: number;
  wall: number;
  bonus: number;
  goal: number;
  total: number;
}
export interface ReinforcementTransition {
  state: GridPosition;
  action: ReinforcementAction;
  nextState: GridPosition;
  reward: number;
  rewards: RewardBreakdown;
  /** Reaching the goal is terminal; an episode time limit is a separate truncation. */
  terminated: boolean;
}
export interface ReinforcementRun {
  start: GridPosition;
  path: GridPosition[];
  transitions: ReinforcementTransition[];
  return: number;
  success: boolean;
  steps: number;
  bonusVisits: number;
  wallHits: number;
  truncated: boolean;
}
export interface ReinforcementHistory {
  episode: number;
  return: number;
  success: boolean;
  steps: number;
  bonusVisits: number;
  epsilon: number;
}
export interface ReinforcementUpdate {
  transition: ReinforcementTransition;
  qBefore: number;
  qAfter: number;
  target: number;
  nextMaxQ: number;
  explored: boolean;
  episode: number;
  step: number;
}
export type ReinforcementPolicy = ((state: GridPosition) => ReinforcementAction) & {
  preset: RewardPreset;
  episodes: number;
  qValues(state: GridPosition): readonly number[];
};

const samePosition = (a: GridPosition, b: GridPosition) => a.x === b.x && a.y === b.y;
const stateIndex = ({ x, y }: GridPosition) => y * RL_WIDTH + x;
const direction: Record<ReinforcementAction, GridPosition> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function isReinforcementCellOpen({ x, y }: GridPosition): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < RL_WIDTH &&
    y >= 0 &&
    y < RL_HEIGHT &&
    !RL_WALLS.some((wall) => wall.x === x && wall.y === y)
  );
}

export function stepReinforcement(
  state: GridPosition,
  action: ReinforcementAction,
  preset: RewardPreset,
): ReinforcementTransition {
  if (!isReinforcementCellOpen(state)) throw new RangeError("State must be an open grid cell");
  // The goal is absorbing, so calling step again cannot collect another goal reward.
  if (samePosition(state, RL_GOAL)) {
    return {
      state: { ...state },
      action,
      nextState: { ...state },
      reward: 0,
      rewards: { step: 0, wall: 0, bonus: 0, goal: 0, total: 0 },
      terminated: true,
    };
  }
  const delta = direction[action];
  const candidate = { x: state.x + delta.x, y: state.y + delta.y };
  const hitWall = !isReinforcementCellOpen(candidate);
  const nextState = hitWall ? { ...state } : candidate;
  const terminated = samePosition(nextState, RL_GOAL);
  const rewards: RewardBreakdown = {
    step: -0.1,
    wall: hitWall ? -1 : 0,
    bonus: preset === "bonus" && !hitWall && samePosition(nextState, RL_BONUS) ? 2 : 0,
    goal: terminated ? 10 : 0,
    total: 0,
  };
  rewards.total = rewards.step + rewards.wall + rewards.bonus + rewards.goal;
  return { state: { ...state }, action, nextState, reward: rewards.total, rewards, terminated };
}

/** The terminal target contains no bootstrap, even if nextMaxQ is nonzero. */
export function calculateReinforcementUpdate(
  qBefore: number,
  reward: number,
  nextMaxQ: number,
  terminated: boolean,
): { target: number; qAfter: number } {
  const target = reward + (terminated ? 0 : RL_GAMMA * nextMaxQ);
  return { target, qAfter: qBefore + RL_ALPHA * (target - qBefore) };
}

function newRun(start: GridPosition): ReinforcementRun {
  return {
    start: { ...start },
    path: [{ ...start }],
    transitions: [],
    return: 0,
    success: samePosition(start, RL_GOAL),
    steps: 0,
    bonusVisits: 0,
    wallHits: 0,
    truncated: false,
  };
}

function appendTransition(run: ReinforcementRun, transition: ReinforcementTransition): void {
  run.transitions.push(transition);
  run.path.push({ ...transition.nextState });
  run.return += transition.reward;
  run.success = transition.terminated;
  run.steps++;
  if (
    !samePosition(transition.state, transition.nextState) &&
    samePosition(transition.nextState, RL_BONUS)
  ) {
    run.bonusVisits++;
  }
  if (transition.rewards.wall < 0) run.wallHits++;
  run.truncated = !run.success && run.steps >= RL_MAX_STEPS;
}

function greedyAction(values: readonly number[]): ReinforcementAction {
  // A fixed tie order makes evaluation deterministic and consumes no training RNG.
  return RL_ACTIONS[values.indexOf(Math.max(...values))];
}

export function evaluateReinforcement(
  policy: ReinforcementPolicy,
  start: GridPosition,
  preset: RewardPreset = policy.preset,
): ReinforcementRun {
  const run = newRun(start);
  while (!run.success && !run.truncated) {
    const state = run.path[run.path.length - 1];
    appendTransition(run, stepReinforcement(state, policy(state), preset));
  }
  return run;
}

export function createReinforcementTrainer(preset: RewardPreset, seed = 1337) {
  const table = Array.from({ length: RL_WIDTH * RL_HEIGHT }, () => [0, 0, 0, 0]);
  const history: ReinforcementHistory[] = [];
  let episode = 0;
  let lastEpisode: ReinforcementRun | null = null;
  let lastUpdate: ReinforcementUpdate | null = null;
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };

  return {
    get episode() {
      return episode;
    },
    get done() {
      return episode >= RL_EPISODES;
    },
    get history(): readonly ReinforcementHistory[] {
      return history;
    },
    get lastEpisode(): ReinforcementRun | null {
      return lastEpisode;
    },
    get lastUpdate(): ReinforcementUpdate | null {
      return lastUpdate;
    },
    /** Advance by whole training episodes; the UI may replay the most recent path. */
    step(count = 1): void {
      for (let i = 0; i < count && episode < RL_EPISODES; i++) {
        const epsilon = Math.max(0.08, 1 - episode / 500);
        const run = newRun(RL_STARTS[episode % RL_STARTS.length]);
        while (!run.success && !run.truncated) {
          const state = run.path[run.path.length - 1];
          const values = table[stateIndex(state)];
          const explored = random() < epsilon;
          const action = explored
            ? RL_ACTIONS[Math.floor(random() * RL_ACTIONS.length)]
            : greedyAction(values);
          const transition = stepReinforcement(state, action, preset);
          const actionIndex = RL_ACTIONS.indexOf(action);
          const qBefore = values[actionIndex];
          const nextMaxQ = Math.max(...table[stateIndex(transition.nextState)]);
          const update = calculateReinforcementUpdate(
            qBefore,
            transition.reward,
            nextMaxQ,
            transition.terminated,
          );
          values[actionIndex] = update.qAfter;
          appendTransition(run, transition);
          lastUpdate = {
            transition,
            qBefore,
            qAfter: update.qAfter,
            target: update.target,
            nextMaxQ,
            explored,
            episode: episode + 1,
            step: run.steps,
          };
          // A time limit truncates collection, not the position's future value.
          // Only the absorbing goal suppresses bootstrapping above.
        }
        episode++;
        lastEpisode = run;
        history.push({
          episode,
          return: run.return,
          success: run.success,
          steps: run.steps,
          bonusVisits: run.bonusVisits,
          epsilon,
        });
      }
    },
    snapshot(): ReinforcementPolicy {
      const frozen = table.map((values) => [...values]);
      return Object.assign((state: GridPosition) => greedyAction(frozen[stateIndex(state)]), {
        preset,
        episodes: episode,
        qValues: (state: GridPosition): readonly number[] => [...frozen[stateIndex(state)]],
      });
    },
  };
}
