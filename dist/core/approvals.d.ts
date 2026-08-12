export declare function canApprove(requiredRole: string | null, requiredUsers: string[] | null, decider: string | null, requester: string | null, deciderRoles: string[]): boolean;
export declare function inboxVisible(row: {
    required_role: string | null;
    required_users: string[] | null;
    requester_email: string | null;
}, callerEmail: string | null, callerRoles: string[]): boolean;
export declare function resolveApprover(roles: Record<string, string> | undefined, users: Record<string, string[]> | undefined, tool: string): {
    role: string | null;
    users: string[] | null;
};
//# sourceMappingURL=approvals.d.ts.map