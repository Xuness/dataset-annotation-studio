import type { components } from "./generated/schema";

type Schemas = components["schemas"];

export type ApiSchema<Name extends keyof Schemas> = Schemas[Name];

type DeepRequired<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? DeepRequired<Item>[]
    : Value extends object
      ? { [Key in keyof Value]-?: DeepRequired<Exclude<Value[Key], undefined>> }
      : Exclude<Value, undefined>;

// FastAPI response models serialize declared defaults, while OpenAPI marks many
// nullable/defaulted fields as optional input properties. Response DTOs use this
// helper so UI consumers see the payload shape that is actually returned.
export type ApiOutput<Name extends keyof Schemas> = DeepRequired<Schemas[Name]>;
