// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Builder helpers for the per-stage Ros2Concept (the content that fills
// the bottom "ROS Lab" panel). Each stage's `ros2: { ... }` field has the
// same fixed shape — these helpers keep the call sites compact and let
// authors describe the topic graph without nesting `pub` / `sub` arrays
// by hand.

import type { Ros2Concept, Ros2State, TopicInfo, ServiceInfo } from "../types";

export interface TopicSpec {
  name: string;
  type: string;
  pub?: readonly string[];
  sub?: readonly string[];
}

export interface ServiceSpec {
  name: string;
  type: string;
  node?: string;
}

/** Builds a `TopicInfo`. Prefer this over inline object literals — it's
 *  trivially shorter and the type inference catches typos. */
export function topic(
  name: string,
  type: string,
  conn: { pub?: readonly string[]; sub?: readonly string[] } = {},
): TopicInfo {
  return {
    name,
    type,
    pub: conn.pub ? [...conn.pub] : undefined,
    sub: conn.sub ? [...conn.sub] : undefined,
  };
}

export function service(name: string, type: string, node?: string): ServiceInfo {
  return { name, type, node };
}

export function state(opts: {
  nodes?: readonly string[];
  topics?: readonly TopicInfo[];
  services?: readonly ServiceInfo[];
}): Ros2State {
  return {
    nodes: opts.nodes ? [...opts.nodes] : [],
    topics: opts.topics ? [...opts.topics] : [],
    services: opts.services ? [...opts.services] : undefined,
  };
}

/** Pass-through; useful for inline narrowing without restating the type. */
export function defineRos2Concept(c: Ros2Concept): Ros2Concept {
  return c;
}
