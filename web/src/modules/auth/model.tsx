// Re-export from app layer — auth context is infrastructure, not a peer module.
// Import from @app/context/auth directly in new code.
export { AuthProvider, type AuthState, useAuth } from "@app/context/auth.tsx";
