/**
 * Utility functions for the frontend.
 */

/**
 * Strips <think> and <thought> tags from a string.
 * Used as a fallback if the backend fails to strip them.
 */
export function stripThoughts(content: string): string {
    if (!content) return "";
    return content
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .replace(/<think>[\s\S]*$/gi, "") // Handle unclosed tags
        .replace(/<thought>[\s\S]*$/gi, "")
        .trim();
}
