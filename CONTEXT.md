# App Feedback

The language of reporting app problems and requesting improvements through a shared team conversation.

## Language

**User**:
A person who uses the app and can report a bug or request a feature.
_Avoid_: Scientist

**Feedback report**:
A user's description of an app problem or desired improvement. It may contain text, screenshots, screen recordings, or a combination.
_Avoid_: Ticket (a report can exist before a ticket)

**Request thread**:
The conversation attached to an individual feedback report in the shared channel.
_Avoid_: Channel (the shared channel contains multiple request threads)

**Target app**:
The application that feedback reports concern and proposed changes modify.
_Avoid_: Feedback system (the system coordinating the request is separate)

**Requester**:
The user who starts an individual feedback report and confirms whether the resulting change meets their need.
_Avoid_: Approver (engineering approval is a separate responsibility)

**Requester acceptance**:
The requester's explicit confirmation that the previewed change meets the agreed need. An agent's technical verification does not constitute requester acceptance.
_Avoid_: Tests passed, merged

**Engineering approval**:
An engineer's authorization to integrate a proposed change into the target app.
_Avoid_: Requester acceptance

**Implementation authorization**:
An engineer's explicit permission to start implementing a request after its requester confirms the acceptance criteria.
_Avoid_: Engineering approval (which authorizes integration)

**Feedback agent**:
The agent responsible for a report's clarification, ticket coordination, human decisions, and communication with its requester.
_Avoid_: Implementation agent

**Implementation agent**:
The agent responsible for investigating and implementing an authorized request and producing verification evidence and a proposed change.
_Avoid_: Feedback agent

**Acceptance criteria**:
Requester-confirmed statements of observable behavior that define what a particular change must accomplish. They describe the desired result rather than the implementation.
_Avoid_: Implementation plan

**Implementation pool**:
The shared set of authorized requests available for eligible implementation agents to claim.
_Avoid_: Single-worker queue

**Implementation claim**:
The exclusive assignment of one request to one implementation agent. It prevents duplicate implementation of that request while unrelated requests proceed independently.
_Avoid_: Team-wide lock

**Shared tracker**:
The common GitHub Issues repository used by a feedback room to preserve requests and their progress across agent sessions and handoffs.
_Avoid_: Agent memory (individual conversation memory is not the shared work record)

**Implementation attempt**:
One implementation pass followed by verification. Failed verification can trigger a corrective attempt; waiting for information or an unavailable service is a pause rather than an attempt.
_Avoid_: Message, tool call

**PR handoff**:
Delivery of a technically verified proposed change to engineering, with a working preview where applicable. It does not mean the change has been accepted, merged, or shipped.
_Avoid_: Released, resolved

**Coordination service**:
The component that records and enforces request transitions, exclusive claims, and human decisions across agents. Its operational records support the shared tracker rather than replace it.
_Avoid_: Chat platform, issue tracker
