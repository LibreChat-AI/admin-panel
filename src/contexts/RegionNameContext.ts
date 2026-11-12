import { createContext } from 'react';

/**
 * The name of the settings container around a group ("OpenAI", "salesforce",
 * "Text to speech"). A group names its region "<container> – <group>", so
 * the landmark list tells "OpenAI – Title generation" from "Google – Title
 * generation". Null at the top level.
 */
export const RegionNameContext = createContext<string | null>(null);
