import { GENERAL_URL_PARAMETERS } from './general-parameters.js';
import { THEME_URL_PARAMETERS } from './theme-parameters.js';
import { ODYSSEY_URL_PARAMETERS } from './odyssey-parameters.js';
import { PLAYGROUND_URL_PARAMETERS } from './playground-parameters.js';

/** Read-only documentation; importing this catalog does not evaluate any runtime flag. */
export const URL_PARAMETER_CATALOG = Object.freeze([
    ...GENERAL_URL_PARAMETERS,
    ...ODYSSEY_URL_PARAMETERS,
    ...THEME_URL_PARAMETERS,
    ...PLAYGROUND_URL_PARAMETERS,
].map((entry) => Object.freeze({ ...entry, sources: Object.freeze([...entry.sources]) })));
