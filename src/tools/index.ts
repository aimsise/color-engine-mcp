/**
 * Barrel re-export for all tool registration functions and the shared validation
 * guard. Provides a single import surface for consumers (Scope #5).
 *
 * `server.ts` still imports directly from each tool file (no change needed);
 * this module is additive.
 */
export { registerParseColor, parseColorTool } from './parse_color.js';
export { registerConvertColor, convertColorTool } from './convert_color.js';
export { registerContrast, contrastTool } from './contrast.js';
export { registerGamutMap, gamutMapTool } from './gamut_map.js';
export { registerGenerateRamp, generateRampTool } from './generate_ramp.js';
export { registerSolveForContrast, solveTool } from './solve_for_contrast.js';
export { validateColorComponents } from '../shared/validation.js';
