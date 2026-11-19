import { STRINGS, TEMPLATES } from "../strings";

/** The English resource: every UI string plus every helper template. */
export const EN = { ...STRINGS, ...TEMPLATES } as const;
