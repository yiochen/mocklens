Build a command-line tool for working with static mobile UI mockups written in HTML and CSS.

## Goal

The tool should help AI coding agents create realistic phone app mockups without accidentally turning the work into a full application implementation.

The mockups are visual artifacts, similar to Figma screens, but represented as inspectable HTML and CSS.

The tool should close the visual feedback loop:

1. An agent creates or edits static screen files.
2. The tool renders those screens at realistic phone dimensions.
3. The tool produces screenshots that the agent and human can inspect.
4. The tool detects obvious layout problems and reports them clearly.
5. The agent can use those reports and screenshots to improve the mocks.

The tool should prioritize simplicity, determinism, and usefulness to coding agents.

## Key results

### Static mock workflow

A project can contain multiple independent mobile screens or visual states.

Examples include:

* Home screen
* Detail screen
* Settings screen
* Empty state
* Error state
* Dialog-open state

Each screen should be viewable independently. The mock files should not need real routing, application state, backend services, or complete business logic.

A person should be able to browse the screens through a reusable local viewer that presents them at phone dimensions.

### Screenshot generation

The tool can render all mock screens into deterministic screenshots.

It should support:

* Common phone viewport sizes
* Multiple configured devices
* Normal viewport screenshots
* Full-page screenshots for long static screens
* Predictable output locations and filenames
* Machine-readable metadata about generated screenshots

The screenshots should be reliable enough for an AI coding agent to inspect and compare across iterations.

### Visual validation

The tool can inspect each screen in a real browser and identify likely visual problems.

The most important initial validation is horizontal overflow.

The tool should detect cases such as:

* The document is wider than the phone viewport
* A card, text block, button, image, or navigation element extends off-screen
* Fixed-width content does not fit smaller devices
* Text is accidentally clipped
* Fixed bottom UI covers meaningful content
* Images fail to load
* The page produces browser errors
* The screen depends unexpectedly on external network resources

The validation does not need to prove that a design is good. It should catch obvious mistakes and point the coding agent toward the likely cause.

### Useful reporting

Validation output should be useful to both humans and AI agents.

For each finding, report enough information to locate and fix the issue, such as:

* Screen
* Device and viewport size
* Severity
* Type of issue
* Likely offending element
* Element dimensions and position
* Relevant text or classes
* Possible explanation or fix

Provide both:

* A concise terminal report
* A stable machine-readable report

The tool should exit with a failure status when serious issues are found so it can be used in automated agent workflows.

### Intentional exceptions

Some visual overflow is intentional, including:

* Decorative background shapes
* Shadows and blur effects
* Partially visible carousel items
* SVG artwork extending outside a container

Provide a simple way for mock authors to annotate intentional cases so they do not create noisy or misleading failures.

These exceptions should not hide genuine document-level horizontal scrolling.

## Constraints

### This is a mockup tool, not an app framework

Do not turn the project into a framework for building production mobile apps.

The tool should not require:

* React or another frontend framework
* Real navigation
* Backend services
* Authentication
* Databases
* Application state management
* Real canvas or drawing functionality
* Complete interaction logic
* Animation systems
* AI model integration
* Figma integration
* Cloud hosting

Plain HTML and CSS should be first-class and sufficient.

Minimal JavaScript inside a mock is acceptable when needed to display a visual state, but interactivity is not the objective.

### Prefer browser truth

Visual checks should be based primarily on how the page renders in a real browser, rather than only inspecting source code.

Use browser layout information such as:

* Viewport dimensions
* Document dimensions
* Element bounding boxes
* Scroll dimensions
* Computed styles
* Browser errors
* Image loading status
* Network requests

### Heuristics should be practical, not perfect

Overflow and overlap detection are inherently heuristic.

The tool should:

* Use multiple signals
* Allow small rendering tolerances
* Reduce duplicate findings
* Prefer likely root causes over listing every affected descendant
* Distinguish serious user-facing failures from decorative warnings
* Document known limitations
* Avoid overwhelming the user with low-value warnings

### Keep the workflow local and deterministic

Normal use should not require internet access.

Rendering and checks should behave consistently across repeated runs where practical.

The implementation should fit naturally into an existing Node.js or TypeScript repository, but the coding agent is free to choose the exact architecture and libraries.

## Verification

Create representative fixture screens and use them to verify the behavior.

At minimum, include examples for:

* A valid screen with no findings
* A screen with document-level horizontal overflow
* A visible child extending off the right edge
* A visible child extending off the left edge
* Overflow caused by a common CSS mistake such as viewport width plus padding
* Intentional decorative overflow
* A carousel with an intentionally peeking next item
* Accidentally clipped text
* Intentionally truncated text
* A broken local image
* A fixed bottom element covering content
* A long static page
* An unexpected external network request
* A browser runtime error

Automated tests should confirm that:

* Real errors are detected
* Intentional exceptions are respected
* Reports identify useful likely offenders
* Serious issues cause a nonzero exit status
* Valid screens pass
* Screenshots are generated for every requested screen and device
* Machine-readable output remains structurally stable

Also perform a manual verification of the local viewer and screenshot output.

## Definition of done

The project is done when a coding agent can use it in a complete visual iteration loop:

1. Create several independent HTML/CSS mobile screens.
2. Open them in a reusable local phone-sized viewer.
3. Generate screenshots for all screens and configured devices.
4. Run validation checks.
5. Receive actionable diagnostics for deliberately introduced layout problems.
6. Fix those problems and rerun the tool successfully.

The implementation is considered complete when:

* Multiple screens can be discovered or configured and viewed independently.
* Device dimensions can be configured.
* Screenshot generation works reliably.
* Long-page screenshots are supported.
* Horizontal overflow detection works for both document-level and element-level cases.
* Intentional visual overflow can be annotated.
* Common rendering failures are reported.
* Human-readable and machine-readable reports are available.
* Error-level findings produce a failing exit status.
* Automated fixture-based tests pass.
* Documentation explains the intended mock-only workflow, usage, exceptions, and heuristic limitations.
* An example project demonstrates the full workflow.

Favor a small, coherent, reliable tool over a broad feature set. Make reasonable implementation decisions based on the existing repository and document important tradeoffs.
