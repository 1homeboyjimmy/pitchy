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
    let stripped = content.replace(/<(think|thought|tool_call|tool_thought|think_process)>[\s\S]*?<\/\1>/gi, "");
    
    // Remove unclosed pure-thought tags (at the end of string)
    stripped = stripped.replace(/<(think|thought|think_process)>[\s\S]*$/gi, "");
    
    // Handle partially present tags at the end to prevent flickering during streaming
    // Matches things like <t, <th, <think, but not <table>
    stripped = stripped.replace(/<(t|th|thi|thin|think|think_|think_p|think_pr|think_pro|think_proc|think_proce|think_proces|think_process|tho|thou|thoug|thought)?$/gi, "");
    
    return stripped.trim();
}

/**
 * Combines multiple class names into a single string.
 */
export function cn(...inputs: (string | undefined | null | boolean)[]) {
    return inputs.filter(Boolean).join(" ");
}
