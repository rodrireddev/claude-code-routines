export interface FireData {
  claude_code_session_id?: string;
  claude_code_session_url?: string;
  error?: { message?: string };
  raw?: string;
}

export interface FireResponse {
  ok?: boolean;
  status?: number;
  data?: FireData;
  error?: string;
}
