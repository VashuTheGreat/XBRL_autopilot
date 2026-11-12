"""AI fix agent (docs/07-ai-fix-agent.md, ADR-0012): one validation problem + its context bundle → reviewable patches.

Stateless: the desktop app sends the bundle with every request; the agent only proposes. The engine checks every patch
before the user sees it and applies the ones the user accepts.
"""
