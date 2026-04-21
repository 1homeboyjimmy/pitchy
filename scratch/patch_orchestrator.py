import re
import sys

def main():
    path = r"c:\Users\eat07\ai startup\chat_orchestrator.py"
    with open(path, "r", encoding="utf-8") as f:
        code = f.read()
        
    mini_graph_method = '''
    def _extract_mini_graph(self, state: dict) -> str:
        """Extract populated variables and relations to form a context mini-graph."""
        nodes = state.get("nodes", [])
        graph_data = {}
        for n in nodes:
            collected = {}
            for inp in n.get("data", {}).get("inputs", []):
                val = inp.get("value")
                if val:
                    collected[inp.get("field", "")] = val
            if collected:
                graph_data[n.get("id")] = collected
                
        lines = []
        if "project_description" in graph_data:
            lines.append(f"Проект: {graph_data['project_description'].get('concept', 'Не определено')} ({graph_data['project_description'].get('business_type', '')})")
        if "target_audience" in graph_data:
            lines.append(f"ЦА: {graph_data['target_audience'].get('client_type', '')} из {graph_data['target_audience'].get('geo', '')}")
        if "competitors" in graph_data:
            lines.append(f"Конкуренты: {graph_data['competitors'].get('competitor_names', '')}")
            lines.append(f"Наше преимущество (UVP): {graph_data['competitors'].get('competitive_advantage', '')}")
        if "monetization" in graph_data:
            lines.append(f"Модель дохода: {graph_data['monetization'].get('revenue_model', '')} (Чек: {graph_data['monetization'].get('avg_check', '')})")
        
        return "\\n".join(lines) if lines else "Связи пока не сформированы (карта пуста)."

    @observe(name="orchestrator_process_message")
'''
    code = code.replace('    @observe(name="orchestrator_process_message")\n', mini_graph_method)

    process_message_repl = '''    async def process_message(self, user_message: str, active_node_id: str = None, client_id: str = None, assistant_client_id: str = None, use_deep_search: bool = False, use_research: bool = False):
        """Main entry point for chat orchestration. Yields JSON chunks."""
        
        # Step 0: Fast Path (Semantic Cache)
        cached_response = await semantic_cache.get(query=user_message, project_id=str(self.tree_id))
        if cached_response and not use_deep_search and not use_research:
            yield json.dumps({"type": "chunk", "content": cached_response}) + "\\n"
            yield json.dumps({"type": "metadata", "model": "Semantic Cache (Hit)"}) + "\\n"
            yield json.dumps({"type": "final", "readiness_index": 0}) + "\\n"
            return

        # Step 1: Parallel Execution (asyncio.gather)
        intent_task = asyncio.create_task(dispatch_intent(user_message))
        from slm_dispatcher import slm_dispatcher
        slm_intent_task = asyncio.create_task(slm_dispatcher.classify_query_intent(user_message))
        rag_task = asyncio.to_thread(rag.get_relevant_chunks, user_message, top_k=10) # Ask for 10 for Swarm
        state_task = asyncio.create_task(self.load_state())
        
        results = await asyncio.gather(intent_task, slm_intent_task, rag_task, state_task, return_exceptions=True)
        
        intent_data = results[0] if not isinstance(results[0], Exception) else IntentClassification(intent="chat", reasoning="Fallback due to error", confidence=0.0)
        slm_res = results[1] if not isinstance(results[1], Exception) else {}
        initial_rag_chunks = results[2] if not isinstance(results[2], Exception) else []
        state = results[3] if not isinstance(results[3], Exception) else {"nodes": [], "readiness_index": 0}
        
        history = await self.get_chat_history(node_id=active_node_id)
        
        intent = intent_data.intent if intent_data.intent != "tree" else "roadmap" 
        is_deep_search = slm_res.get("is_deep_search", False)
        is_finance = slm_res.get("is_finance", False)
        if is_finance:
            intent = "finance"
            
        logger.info(f"Orchestrator: User intent classified as '{intent}', deep_search: {is_deep_search}")

        reply_full = ""
        thoughts_full = ""
        model_used = "Makura (GLM-5)"
        enriched_data = {}
        sources_list = []
        usage_data = None
        message_saved = False

        if langfuse_context:
            langfuse_context.update_current_observation(
                name=f"chat_orchestrator_{intent}",
                user_id=str(self.user_id),
                session_id=str(self.tree_id),
                tags=[intent, "deep_search" if use_deep_search else "basic_search"]
            )

        # Step 1.5: Web Search if needed
        search_texts = []
        if intent == "search" or is_deep_search or use_deep_search or use_research:
            yield json.dumps({"type": "thought", "content": "Выполняю поиск по интернету (Exa AI)...\\n"}) + "\\n"
            from search_agent import async_search_with_sources
            search_sources, search_context = await async_search_with_sources(user_message, use_deep_search=True)
            sources_list = search_sources
            if search_context:
                search_texts = [search_context]
                
        # Step 1.6: Dynamic Mini-Graph
        mini_graph = self._extract_mini_graph(state)
        
        # Step 1.7: Swarm Analysis (Map-Reduce)
        from swarm_agent import run_analytical_swarm
        rag_texts = [c["text"] if isinstance(c, dict) else c for c in initial_rag_chunks]
        chunks_to_swarm = rag_texts[:10] + search_texts
        swarm_facts = ""
        
        if (intent in ["chat", "finance", "search", "presentation"]) and chunks_to_swarm:
            yield json.dumps({"type": "thought", "content": "Анализирую данные роем агентов (Qwen 2.5)...\\n"}) + "\\n"
            swarm_facts = await run_analytical_swarm(user_message, chunks_to_swarm)
            
        compiled_rag_context = ""
        if mini_graph and "карта пуста" not in mini_graph:
            compiled_rag_context += f"ДАННЫЕ ИЗ SMART ROADMAP (Мини-Граф проекта):\\n{mini_graph}\\n\\n"
        if swarm_facts:
            compiled_rag_context += f"ПРОВЕРЕННЫЕ ФАКТЫ ИЗ БАЗЫ ЗНАНИЙ И СЕТИ:\\n{swarm_facts}\\n\\n"
        if not swarm_facts and rag_texts:
            compiled_rag_context += f"ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ:\\n{chr(10).join(rag_texts[:3])}\\n\\n"

        try:
            if intent == "chat" or intent not in ["roadmap", "finance", "search", "legal", "presentation", "tree"]:
                yield json.dumps({"type": "metadata", "model": model_used}) + "\\n"
                start_time = time.time()
                ttft = None
                async for json_chunk in self._parse_thought_generator(self._stream_chat(user_message, history, state, active_node_id, rag_context=compiled_rag_context)):
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk": 
                        if ttft is None:
                            ttft = time.time() - start_time
                        reply_full += data["content"]
                    elif data["type"] == "thought":
                        if ttft is None:
                            ttft = time.time() - start_time
                        thoughts_full += data["content"]
                    yield json_chunk
            
            elif intent in ["roadmap", "tree"]:
                user_obj = self.db.query(User).filter(User.id == self.user_id).first()
                if user_obj and user_obj.subscription_tier == "tester":
                    msg = "Функция работы с интерактивной дорожной картой недоступна в тарифе Tester."
                    yield json.dumps({"type": "chunk", "content": msg}) + "\\n"
                    return
                
                reply_full, enriched_data = await self._handle_roadmap_edit(user_message, state, active_node_id)
                yield json.dumps({"type": "chunk", "content": reply_full}) + "\\n"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\\n"
            
            elif intent == "search" or use_research:
                model_used = "Exa/Agent"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\\n"
                
                start_time = time.time()
                ttft = None
                
                prompt = ("Ты — бизнес-аналитик. Пользователь задал вопрос, требующий поиска.\\n\\n"
                          f"{compiled_rag_context}\\n\\n"
                          f"Вопрос: {user_message}\\n\\n"
                          "Дай развернутый ответ, опираясь на факты.")
                system = "Сначала напиши свои мысли в <thought>...</thought>, а затем ответ."
                
                if sources_list:
                    yield json.dumps({"type": "sources", "data": sources_list}) + "\\n"
                    
                async for json_chunk in self._parse_thought_generator(stream_makura(system, prompt)):
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk": 
                        if ttft is None:
                            ttft = time.time() - start_time
                        reply_full += data.get("content", "")
                    elif data["type"] == "thought":
                        if ttft is None:
                            ttft = time.time() - start_time
                        thoughts_full += data.get("content", "")
                    yield json_chunk

            elif intent == "legal":
                reply_full = await self._handle_legal(user_message, rag_context=compiled_rag_context)
                yield json.dumps({"type": "chunk", "content": reply_full}) + "\\n"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\\n"
            
            elif intent == "finance":
                model_used = "Makura (Finance Expert)"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\\n"
                
                node_info = next((n for n in state["nodes"] if n["id"] == active_node_id), {})
                tree_metrics = {}
                for n in state["nodes"]:
                    for inp in n.get("data", {}).get("inputs", []):
                        if inp.get("value"):
                            tree_metrics[inp["field"]] = inp["value"]

                prompt = FINANCE_PROMPT.format(
                    node_context=json.dumps(node_info),
                    tree_metrics=json.dumps(tree_metrics),
                    user_message=user_message
                )
                system_prompt = f"Ты финансовый эксперт Pitchy. На основе контекста ответь пользователю:\\n{compiled_rag_context}"
                
                async for chunk in stream_makura(prompt, system_prompt=system_prompt):
                    if isinstance(chunk, dict):
                        if "__usage__" in chunk:
                            usage_data = chunk["__usage__"]
                        continue
                    yield json.dumps({"type": "chunk", "content": chunk}) + "\\n"
                    reply_full += str(chunk)
            
            elif intent == "presentation":
                user_obj = self.db.query(User).filter(User.id == self.user_id).first()
                if user_obj and user_obj.subscription_tier == "tester":
                    msg = "Генерация презентаций недоступна в тарифе Tester."
                    yield json.dumps({"type": "chunk", "content": msg}) + "\\n"
                    return
                    
                model_used = "Makura (Presentation Builder)"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\\n"
                
                yield json.dumps({"type": "chunk", "content": "Начинаю сборку вашей презентации... Пожалуйста, подождите.\\n\\n"}) + "\\n"
                reply_full += "Начинаю сборку вашей презентации..."
                
                slides, raw_reply, usage_ret = await self._handle_presentation(user_message, state, compiled_rag_context)
                if usage_ret:
                    usage_data = usage_ret
                if slides:
                    yield json.dumps({"type": "presentation", "data": slides}) + "\\n"
                    yield json.dumps({"type": "chunk", "content": "\\nУспешно готово!"}) + "\\n"
                    reply_full += "\\nУспешно готово!"
                else:
                    yield json.dumps({"type": "chunk", "content": "\\nНе удалось сгенерировать."}) + "\\n"
                    reply_full += "\\nНе удалось сгенерировать."
            
            else:
                async for json_chunk in self._parse_thought_generator(self._stream_chat(user_message, history, state, active_node_id)):
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk":
                        reply_full += data["content"]
                    elif data["type"] == "thought":
                        thoughts_full += data["content"]
                    yield json_chunk
                    
        finally:
'''
    
    # We will replace from "async def process_message" up to "finally:"
    old_start = 'async def process_message(self, user_message: str'
    old_end = '        finally:'
    start_idx = code.find(old_start)
    end_idx = code.find(old_end, start_idx)
    
    if start_idx != -1 and end_idx != -1:
        new_code = code[:start_idx] + process_message_repl[4:] + code[end_idx:]
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_code)
        print("Success")
    else:
        print("Could not find replacement boundaries")

if __name__ == "__main__":
    main()
