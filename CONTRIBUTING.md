# Contributing to ParetoMol

Thanks for your interest in contributing! ParetoMol is an open-source tool for multi-objective analysis of drug-like molecules, and we welcome contributions of all kinds.

## Ways to contribute

- **Bug reports** — found something broken? [Open an issue](https://github.com/IlkhamFY/molparetolab/issues/new?template=bug_report.md)
- **Feature requests** — have an idea? [Start a discussion](https://github.com/IlkhamFY/molparetolab/issues/new?template=feature_request.md)
- **Code** — fix a bug, add a feature, improve performance
- **Documentation** — improve the docs, add examples, fix typos
- **Testing** — try the tool on your own datasets and report what works / doesn't

## Getting started

```bash
git clone https://github.com/IlkhamFY/molparetolab.git
cd molparetolab
npm install
npm run dev
```

The app runs at `http://localhost:5173`. All chemistry runs client-side via RDKit.js (WebAssembly).

## Project structure

```
src/
├── components/
│   ├── views/           # Analysis tab components (ParetoView, EggView, etc.)
│   ├── Header.tsx       # Top navigation bar
│   ├── Sidebar.tsx      # Input, molecule list, filters (incl. clipboard paste)
│   ├── Content.tsx      # Tab router + per-tab PNG export
│   ├── AdmetTierModal.tsx # Personal HF Space deploy flow
│   ├── DocsPage.tsx     # Documentation page
│   └── CopilotPanel.tsx # AI Copilot
├── utils/
│   ├── chem.ts          # RDKit.js wrappers, parsing, fingerprints
│   ├── qed.ts           # QED drug-likeness score (Bickerton 2012, ALERTS=0 approx.)
│   ├── admetAI.ts       # ADMET-AI predictions (health check, batch predict)
│   ├── admetTiers.ts    # Three-tier endpoint system (shared/personal/local)
│   ├── ai.ts            # AI Copilot (BYOK: Gemini/OpenAI/Anthropic)
│   ├── types.ts         # Type definitions
│   ├── export.ts        # CSV/SDF/JSON export
│   └── stats.ts         # Statistical computations
└── contexts/
    └── ThemeContext.tsx  # Dark/light mode
```

## Pull request guidelines

1. **Fork and branch** — create a feature branch from `main`
2. **Keep it focused** — one feature or fix per PR
3. **TypeScript must compile** — run `npx tsc -b --noEmit` before submitting
4. **Test in the browser** — load a few molecules and verify your change works
5. **Write a clear description** — what does it do and why

## Code style

- TypeScript + React + Tailwind CSS
- Functional components with hooks
- No external state management (useState/useRef/useMemo/useCallback)
- CSS variables for theming (see `index.css`)
- Keep bundle size small — avoid heavy dependencies

## Issues labeled `good first issue`

Look for issues tagged [`good first issue`](https://github.com/IlkhamFY/molparetolab/labels/good%20first%20issue) if you're new to the project. These are scoped, well-defined tasks with clear acceptance criteria.

## Communication

- **GitHub Issues** — for bugs, features, and technical discussion
- **Email** — ilkhamfy@gmail.com for anything else

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
