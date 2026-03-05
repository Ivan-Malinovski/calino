# Calino Development Plan

## Overview

This folder contains development tasks for the Calino calendar app. Each task is in a separate TXT file with detailed requirements and implementation guidance.

## Task Dependencies

Some tasks should be completed in order due to dependencies:

```
┌─────────────────────────────────────────────────────────────┐
│  REQUIRED ORDER (dependencies)                              │
└─────────────────────────────────────────────────────────────┘

01_all_day_pills_month_view.txt
         ↓
02_all_day_pills_week_view.txt (depends on 01 for pill styling)
         ↓
03_multi_day_spanning_pills.txt (depends on 01, 02 for layout)

04_tasks_view.txt (independent - can be done anytime)

05_event_modal_arrow_keys.txt (independent - small fix)

06_mouse_wheel_month_change.txt (independent - bug fix)

07_swipe_double_trigger.txt (independent - bug fix)

08_relative_to_property.txt (independent - larger feature)
```

## Task Summary

### Features (New Functionality)

| File                            | Task                             | Effort | Dependencies |
| ------------------------------- | -------------------------------- | ------ | ------------ |
| 01_all_day_pills_month_view.txt | All-day pills in MonthView       | Medium | None         |
| 02_all_day_pills_week_view.txt  | All-day pills in WeekView header | Medium | 01           |
| 03_multi_day_spanning_pills.txt | Multi-day spanning pills         | High   | 01, 02       |
| 04_tasks_view.txt               | Dedicated Tasks view             | Medium | None         |
| 08_relative_to_property.txt     | RELATED-TO property support      | High   | None         |

### Bug Fixes

| File                            | Task                          | Effort | Dependencies |
| ------------------------------- | ----------------------------- | ------ | ------------ |
| 05_event_modal_arrow_keys.txt   | EventModal arrow key priority | Low    | None         |
| 06_mouse_wheel_month_change.txt | Mouse wheel month change fix  | Low    | None         |
| 07_swipe_double_trigger.txt     | Swipe double-trigger fix      | Medium | None         |

## Recommended Implementation Order

### Phase 1: Bug Fixes (Quick Wins)

1. 05_event_modal_arrow_keys.txt
2. 06_mouse_wheel_month_change.txt
3. 07_swipe_double_trigger.txt

### Phase 2: All-Day Improvements

4. 01_all_day_pills_month_view.txt
5. 02_all_day_pills_week_view.txt

### Phase 3: Advanced Features

6. 03_multi_day_spanning_pills.txt
7. 04_tasks_view.txt
8. 08_relative_to_property.txt (lower priority)

## Notes for Agents

- Each task file includes:
  - Clear objective
  - Current state analysis
  - Requirements
  - Implementation details
  - Files to modify/create
  - Acceptance criteria

- All file paths are relative to project root
- Follow existing code style from AGENTS.md
- Run `pnpm lint` and `pnpm typecheck` after changes
- Add tests for new features

## Sync Token

The task for implementing CalDAV sync tokens is ON HOLD as requested by the user.

## Questions?

If a task is unclear:

1. Check the referenced source files
2. Look at similar implementations in the codebase
3. Ask for clarification
