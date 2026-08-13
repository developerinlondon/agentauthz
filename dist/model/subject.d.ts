export interface Subject {
  kind: string;
  id: string;
}
export declare function isValidSubject(subject: unknown): subject is Subject;
export declare function subjectEquals(a: Subject, b: Subject): boolean;
// # sourceMappingURL=subject.d.ts.map
