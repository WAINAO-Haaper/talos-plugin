import contract from "./state-contract.json";

export type TalosBallState = keyof typeof contract;

export interface TalosBallStateDefinition {
  emotionId: string;
  label: string;
  upstreamName: string;
}

export const TALOS_BALL_STATE_CONTRACT = Object.freeze(
  contract
) as Readonly<Record<TalosBallState, TalosBallStateDefinition>>;

export const TALOS_BALL_STATES = Object.freeze(
  Object.keys(contract) as TalosBallState[]
);

export const TALOS_BALL_STATE_IDS = Object.freeze(
  Object.fromEntries(
    TALOS_BALL_STATES.map((state) => [
      state,
      TALOS_BALL_STATE_CONTRACT[state].emotionId,
    ])
  )
) as Readonly<Record<TalosBallState, string>>;

export function isTalosBallState(value: string): value is TalosBallState {
  return Object.prototype.hasOwnProperty.call(TALOS_BALL_STATE_CONTRACT, value);
}

export function emotionIdForState(state: TalosBallState): string {
  return TALOS_BALL_STATE_CONTRACT[state].emotionId;
}
