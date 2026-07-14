/** Types for the dependency-free i18n static-audit lexer (implemented in .mjs). */

export declare const COMPONENTS_DIR: string;
export declare const AUDITED: string[];
export declare const ALLOWLIST: Set<string>;

export interface I18nFinding {
	readonly line: number;
	readonly text: string;
}

export declare function isProse(text: string): boolean;
export declare function auditSource(
	filename: string,
	source: string,
): I18nFinding[];
export declare function auditAll(dir?: string): Record<string, I18nFinding[]>;
