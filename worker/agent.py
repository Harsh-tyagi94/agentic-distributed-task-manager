from typing import Annotated, TypedDict
from langchain_core.messages import BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from worker.config import GOOGLE_API_KEY, get_logger
logger = get_logger(__name__)

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=GOOGLE_API_KEY,
    temperature=0.7,
)

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    job_id: str

async def call_model(state: AgentState) -> dict:
    logger.info("Agent node executing for job_id=%s", state["job_id"])
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}

def build_graph() -> StateGraph:
    workflow = StateGraph(AgentState)
    workflow.add_node("agent", call_model)
    workflow.add_edge(START, "agent")
    workflow.add_edge("agent", END)
    return workflow
