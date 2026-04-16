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
        .replace(/<(think|thought|tool_call|tool_thought)>[\s\S]*?<(think|thought|tool_call|tool_thought)>/gi, "") // Handle malformed tags like <tag>...<tag>
        .replace(/<(think|thought|tool_call|tool_thought)>[\s\S]*$/gi, "") // Handle unclosed tags
        .trim();
}
