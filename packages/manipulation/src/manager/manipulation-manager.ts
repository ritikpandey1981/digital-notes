import type { PagePoint } from "@folio/selection";
import type {
  ManipulationChangeListener,
  ManipulationManager,
  ManipulationManagerOptions,
} from "../interfaces/manipulation-manager";
import type { BeginManipulationInput, ManipulationState } from "../model/types";
import { DEFAULT_MANIPULATION_CONFIGURATION } from "../model/types";
import { ManipulationSessionImplementation } from "../session/manipulation-session";
import { createIdleState } from "../state/manipulation-state";
import { createRotationEngine } from "../rotation/rotation-engine";
import { createScaleEngine } from "../scale/scale-engine";
import { createTranslationEngine } from "../translation/translation-engine";

function defaultSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `manipulation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

class ManipulationManagerImplementation implements ManipulationManager {
  private readonly listeners = new Set<ManipulationChangeListener>();
  private readonly dragThreshold: number;
  private readonly translationEngine;
  private readonly rotationEngine;
  private readonly scaleEngine;
  private readonly minimumScale: number;
  private readonly maximumScale: number;
  private readonly createSessionId: () => string;
  private readonly now: () => number;
  private stateValue = createIdleState(0);
  private session: ManipulationSessionImplementation | null = null;

  constructor(options: ManipulationManagerOptions) {
    this.dragThreshold =
      options.configuration?.dragThreshold ?? DEFAULT_MANIPULATION_CONFIGURATION.dragThreshold;
    this.minimumScale =
      options.configuration?.minimumScale ?? DEFAULT_MANIPULATION_CONFIGURATION.minimumScale;
    this.maximumScale =
      options.configuration?.maximumScale ?? DEFAULT_MANIPULATION_CONFIGURATION.maximumScale;
    if (
      !Number.isFinite(this.dragThreshold) ||
      this.dragThreshold < 0 ||
      !Number.isFinite(this.minimumScale) ||
      this.minimumScale <= 0 ||
      !Number.isFinite(this.maximumScale) ||
      this.maximumScale <= this.minimumScale
    ) {
      throw new RangeError(
        "Manipulation configuration requires a non-negative threshold and ordered positive scale limits.",
      );
    }
    this.translationEngine = options.translationEngine ?? createTranslationEngine();
    this.rotationEngine = options.rotationEngine ?? createRotationEngine();
    this.scaleEngine = options.scaleEngine ?? createScaleEngine();
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.now = options.now ?? Date.now;
  }

  beginSession(input: BeginManipulationInput): ManipulationState {
    if (this.session !== null || input.objectId.trim().length === 0) return this.stateValue;
    if (!Number.isSafeInteger(input.pointerId) || input.pointerId < 0) return this.stateValue;
    const sessionId = this.createSessionId();
    const timestamp = this.now();
    if (sessionId.trim().length === 0 || !Number.isFinite(timestamp)) {
      throw new RangeError("Manipulation session identity and timestamp must be valid.");
    }
    const initialRotation = input.initialObjectRotation ?? 0;
    const initialScale = input.initialObjectScale ?? 1;
    if (!Number.isFinite(initialRotation) || !Number.isFinite(initialScale) || initialScale <= 0) {
      throw new RangeError("Manipulation requires a finite rotation and positive finite scale.");
    }
    this.session = new ManipulationSessionImplementation({
      ...input,
      sessionId,
      timestamp,
      initialVersion: this.stateValue.version + 1,
      dragThreshold: this.dragThreshold,
      minimumScale: this.minimumScale,
      maximumScale: this.maximumScale,
      translationEngine: this.translationEngine,
      rotationEngine: this.rotationEngine,
      scaleEngine: this.scaleEngine,
    });
    return this.publish(this.session.state);
  }

  updateSession(position: PagePoint): ManipulationState {
    if (this.session === null) return this.stateValue;
    return this.publish(this.session.update(position));
  }

  commitSession(): ManipulationState {
    if (this.session === null || this.stateValue.phase !== "dragging") return this.stateValue;
    this.publish(this.session.transitionTo("committing"));
    return this.finishSession();
  }

  cancelSession(): ManipulationState {
    if (this.session === null) return this.stateValue;
    this.publish(this.session.transitionTo("cancelling"));
    return this.finishSession();
  }

  getState(): ManipulationState {
    return this.stateValue;
  }

  hasActiveSession(): boolean {
    return this.session !== null;
  }

  subscribe(listener: ManipulationChangeListener): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private finishSession(): ManipulationState {
    this.session = null;
    return this.publish(createIdleState(this.stateValue.version + 1));
  }

  private publish(state: ManipulationState): ManipulationState {
    if (state === this.stateValue) return state;
    const previous = this.stateValue;
    this.stateValue = state;
    for (const listener of [...this.listeners]) listener(state, previous);
    return state;
  }
}

/** Creates an isolated manipulation manager with no global state. */
export function createManipulationManager(
  options: ManipulationManagerOptions = {},
): ManipulationManager {
  return new ManipulationManagerImplementation(options);
}
