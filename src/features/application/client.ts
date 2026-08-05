/**
 * 클라이언트 컴포넌트에서 쓰는 진입점.
 *
 * index.ts 는 api/*(DB 직접 접근)까지 re-export 하므로 클라이언트 경계에서
 * import 하면 pg 가 브라우저 번들로 끌려간다. 클라이언트에서는 반드시 이 파일을 쓴다.
 */
export { ApplicationStatusControl } from "./components/application-status-control";
export { DraftEditor } from "./components/draft-editor";
export { ReviewPanel } from "./components/review-panel";
export { SaveApplicationButton } from "./components/save-application-button";
export { DRAFT_SECTIONS } from "./sections";
export { STATUS_LABELS, STATUS_ORDER } from "./status";
