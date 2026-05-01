/**
 * Utility functions for the frontend.
 */

/**
 * Strips <think> and <thought> tags from a string.
 * Used as a fallback if the backend fails to strip them.
 */
export function stripThoughts(content: string): string {
    if (!content) return "";
    
    // Remove complete tags
    let stripped = content.replace(/<(think|thought|tool_call|tool_thought)>[\s\S]*?<\/\1>/gi, "");
    
    // Remove unclosed pure-thought tags (at the end of string)
    stripped = stripped.replace(/<(think|thought)>[\s\S]*$/gi, "");
    
    // Handle partially present tags at the end to prevent flickering during streaming
    // Matches things like <t, <th, <think, but not <table>
    stripped = stripped.replace(/<(t|th|thi|thin|think|tho|thou|thoug|thought)?$/gi, "");
    
    return stripped.trim();
}
