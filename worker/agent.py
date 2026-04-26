from typing import Annotated, TypedDict
from langchain_core.messages import BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper
from langfuse.langchain import CallbackHandler
from langfuse import Langfuse, get_client
from langgraph.prebuilt import ToolNode, tools_condition

from worker.config import GOOGLE_API_KEY, get_logger, LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
logger = get_logger(__name__)

wikipedia_tool = WikipediaQueryRun(api_wrapper=WikipediaAPIWrapper())
tools = [wikipedia_tool]

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=GOOGLE_API_KEY,
    temperature=0.7,
)
llm_with_tools = llm.bind_tools(tools)

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    job_id: str

langfuse_client = Langfuse(
    public_key=LANGFUSE_PUBLIC_KEY,
    secret_key=LANGFUSE_SECRET_KEY,
    host=LANGFUSE_BASE_URL
)
langfuse_client = get_client()
if langfuse_client.auth_check():
    logger.info("Langfuse connection verified successfully")
else:
    logger.error("Langfuse auth failed — check LANGFUSE_PUBLIC_KEY and LANGFUSE_BASE_URL")


def get_langfuse_handler(job_id: str) -> CallbackHandler:
    """
    Per-job Langfuse trace. Each job appears as a separate trace
    in the Langfuse UI at localhost:3100, showing every LLM call
    and tool invocation with token counts and latency.
    """
    return CallbackHandler()

async def call_model(state: AgentState) -> dict:
    logger.info("Agent node executing for job_id=%s", state["job_id"])
    response = await llm_with_tools.ainvoke(state["messages"])
    return {"messages": [response]}

def build_graph() -> StateGraph:
    workflow = StateGraph(AgentState)
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", ToolNode(tools))
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", tools_condition)
    workflow.add_edge("tools", "agent")
    return workflow
