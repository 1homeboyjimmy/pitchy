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
        .replace(/<(think|thought|tool_call|tool_thought)>[\s\S]*?<\/\1>/gi, "")
        // If a tag is unclosed towards the end, only strip it if it's a known pure-thought tag
        .replace(/<(think|thought)>[\s\S]*$/gi, "") 
        // DO NOT strip unclosed tool_call tags as they might contain the leaked answer
        .trim();
}
