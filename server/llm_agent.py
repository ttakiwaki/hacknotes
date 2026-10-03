import os
from typing import AsyncGenerator, Optional, Callable
from openai import AsyncOpenAI
from graph_engine import GraphEngine


class LLMAgent:
    def __init__(self, graph_engine: GraphEngine, search_symbols_fn: Optional[Callable] = None):
        self.graph_engine = graph_engine
        self.search_symbols = search_symbols_fn

        base_url = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
        api_key = os.getenv("LLM_API_KEY", "dummy-key")
        self.model = os.getenv("LLM_MODEL", "google/gemini-2.0-flash-001")

        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    def resolve_target(self, question: str, explicit_node_id: Optional[str]) -> Optional[str]:
        """
        Resolves target symbol ID:
        1. Explicit node_id if valid
        2. Exact match in database by name or ID
        3. Victor's search_symbols semantic search fallback
        """
        if explicit_node_id and explicit_node_id in self.graph_engine.nodes_dict:
            return explicit_node_id

        # Exact match attempt
        for node_id, node in self.graph_engine.nodes_dict.items():
            if node.name.lower() == question.strip().lower() or node_id == question.strip():
                return node_id

        # Semantic fallback via Victor's search_symbols
        if self.search_symbols:
            try:
                results = self.search_symbols(question, k=1)
                if results and len(results) > 0:
                    top_hit = results[0]["node_id"]
                    if top_hit in self.graph_engine.nodes_dict:
                        return top_hit
            except Exception as e:
                print(f"Error calling search_symbols: {e}")

        return None

    async def stream_explanation(
        self, question: str, target_id: str, impacted_ids: list[str]
    ) -> AsyncGenerator[str, None]:
        """Constructs context prompt and streams response chunks from LLM."""
        target_node = self.graph_engine.nodes_dict[target_id]
        target_code = self.graph_engine.get_snippet(target_id) or "// Code unavailable"

        neighbor_context = []
        for imp_id in impacted_ids[:5]:  # Cap neighbor context to top 5
            code = self.graph_engine.get_snippet(imp_id)
            if code:
                neighbor_context.append(f"--- Dependent Symbol: {imp_id} ---\n{code}")

        neighbors_text = "\n\n".join(neighbor_context) if neighbor_context else "No direct code dependents found."

        # Parenthesized string concatenation avoids syntax errors with internal quotes/backslashes
        prompt = (
            f"You are an expert codebase debugging assistant.\n"
            f"User Question: {question}\n\n"
            f"Target Symbol: {target_node.name} ({target_node.id})\n"
            f"Target Code:\n"
            f"```\n{target_code}\n```\n\n"
            f"Impacted/Dependent Symbols (Reverse BFS Depth 2):\n"
            f"{neighbors_text}\n\n"
            f"Explain concisely what might break or be affected when modifying `{target_node.name}`.\n"
            f"Mention relevant function and class names clearly so the UI can highlight them. Keep it direct and focused on risks."
        )

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content