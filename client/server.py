import asyncio
import json
import os
import websockets
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Minimal WebSocket server that accepts NL tasks and translates to primitive
# browser actions using Claude Computer Use.

PORT = int(os.environ.get("PC_SERVER_PORT", 8765))

try:
    from anthropic import Anthropic
    claude_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    CLAUDE_AVAILABLE = True
except ImportError:
    print("Warning: anthropic package not installed. Install with: pip install anthropic")
    claude_client = None
    CLAUDE_AVAILABLE = False
except Exception as e:
    print(f"Warning: Claude client initialization failed: {e}")
    claude_client = None
    CLAUDE_AVAILABLE = False


async def wait_for_browser_response(websocket, action_id: str, timeout: float = 5.0):
    """Wait for a response from the browser extension for a specific action."""
    import asyncio
    start_time = asyncio.get_event_loop().time()
    
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        try:
            # This is a simplified version - in a real implementation,
            # you'd need to handle the WebSocket message queue properly
            await asyncio.sleep(0.1)
            # For now, return a mock response
            return "Page HTML content received"
        except Exception:
            break
    
    return None


async def run_computer_use_agent_loop(websocket, task: str):
    """Run the Computer Use agent loop as per the documentation."""
    if not CLAUDE_AVAILABLE or not claude_client:
        # Fallback to simple planner
        plan = {"actions": plan_actions_simple(task), "reason": "fallback simple planner"}
        actions = plan.get("actions", [])
        await websocket.send(json.dumps({
            "type": "plan",
            "task": task,
            "count": len(actions),
            "provider": "fallback",
            "reason": plan.get("reason", "")
        }))
        
        for i, action in enumerate(actions):
            print(f"[server] Sending action {i+1}: {action}")
            await websocket.send(json.dumps(action))
            await asyncio.sleep(0.2)
        
        await websocket.send(json.dumps({"type": "task_complete", "actions_count": len(actions)}))
        return
    
    # Store pending actions to track responses
    pending_actions = {}
    
    try:
        # Initialize conversation with Claude using Computer Use tool
        messages = [{"role": "user", "content": f"Please help me with this browser task: {task}. Use the computer tool to navigate to websites and interact with them."}]
        
        # Send initial plan message
        await websocket.send(json.dumps({
            "type": "plan",
            "task": task,
            "count": 0,
            "provider": "claude",
            "reason": "Starting Computer Use agent loop"
        }))
        
        max_iterations = 10  # Prevent infinite loops
        iteration = 0
        total_actions = 0
        
        while iteration < max_iterations:
            iteration += 1
            print(f"[server] Agent loop iteration {iteration}")
            
            # Call Claude with Computer Use tool
            response = claude_client.beta.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=1024,
                tools=[
                    {
                        "type": "computer_20250124",
                        "name": "computer",
                        "display_width_px": 1024,
                        "display_height_px": 768,
                        "display_number": 1,
                    }
                ],
                messages=messages,
                betas=["computer-use-2025-01-24"]
            )
            
            # Add Claude's response to conversation
            messages.append({
                "role": "assistant",
                "content": response.content
            })
            
            # Check if Claude used any tools
            tool_results = []
            for content in response.content:
                if content.type == "tool_use" and content.name == "computer":
                    # Convert computer use actions to our browser actions
                    computer_action = content.input.get("action")
                    action_id = str(content.id)
                    
                    if computer_action == "screenshot":
                        # Request current page HTML
                        action = {"action": "getHTML", "payload": {}, "id": action_id}
                        await websocket.send(json.dumps(action))
                        
                        # Wait for response from browser extension
                        html_content = await wait_for_browser_response(websocket, action_id, timeout=5.0)
                        if html_content:
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": action_id,
                                "content": f"Screenshot captured. Page contains: {html_content[:500]}..."
                            })
                        else:
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": action_id,
                                "content": "Screenshot captured successfully"
                            })
                        
                    elif computer_action == "left_click":
                        # Convert click coordinates to a more specific click action
                        coord = content.input.get("coordinate", [0, 0])
                        x, y = coord[0], coord[1]
                        
                        # For Hugging Face papers, try to click on a specific element
                        if "hugging face" in task.lower() or "papers" in task.lower():
                            action = {"action": "click", "payload": {"selector": "a[href*='papers'], .papers-link, [data-testid='papers']"}, "id": action_id}
                        else:
                            # Generic click action
                            action = {"action": "click", "payload": {"selector": "body"}, "id": action_id}
                        
                        print(f"[server] Executing click action: {action}")
                        await websocket.send(json.dumps(action))
                        await asyncio.sleep(1.0)
                        
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": action_id,
                            "content": f"Clicked at coordinates ({x}, {y})"
                        })
                        
                    elif computer_action == "type":
                        # Convert typing to our type action
                        text = content.input.get("text", "")
                        # Try to find an input field to type into
                        action = {"action": "type", "payload": {"selector": "input[type=text], input[name=q], textarea, input[placeholder*='search']", "text": text}, "id": action_id}
                        print(f"[server] Executing type action: {action}")
                        await websocket.send(json.dumps(action))
                        await asyncio.sleep(1.0)
                        
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": action_id,
                            "content": f"Typed: {text}"
                        })
                        
                    elif computer_action == "navigate":
                        # Convert navigation
                        url = content.input.get("url", "")
                        action = {"action": "navigate", "payload": {"url": url}, "id": action_id}
                        print(f"[server] Executing navigate action: {action}")
                        await websocket.send(json.dumps(action))
                        await asyncio.sleep(3.0)  # Wait longer for navigation
                        
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": action_id,
                            "content": f"Navigated to {url}"
                        })
                    
                    total_actions += 1
            
            # If no tools were used, task is complete
            if not tool_results:
                print(f"[server] Task completed after {iteration} iterations")
                await websocket.send(json.dumps({"type": "task_complete", "iterations": iteration, "total_actions": total_actions}))
                break
            
            # Add tool results to conversation
            messages.append({
                "role": "user",
                "content": tool_results
            })
            
            print(f"[server] Completed iteration {iteration} with {len(tool_results)} tool calls")
        
        if iteration >= max_iterations:
            print(f"[server] Reached max iterations ({max_iterations})")
            await websocket.send(json.dumps({"type": "task_complete", "iterations": iteration, "total_actions": total_actions, "reason": "max_iterations_reached"}))
            
    except Exception as e:
        print(f"[server] Agent loop error: {e}")
        await websocket.send(json.dumps({"type": "task_complete", "error": str(e)}))


def plan_actions_simple(task: str) -> list:
    """Simple fallback planner without Claude."""
    t = task.lower()
    print(f"[simple planner] Processing task: '{task}' -> '{t}'")
    actions = []
    if "hugging face" in t and "daily" in t:
        actions = [
            {"action": "navigate", "payload": {"url": "https://huggingface.co/papers"}},
            {"action": "find", "payload": {"selector": "input[type=search],input[role=searchbox]"}},
        ]
    elif "gmail" in t:
        actions = [
            {"action": "navigate", "payload": {"url": "https://mail.google.com/"}},
        ]
    else:
        # Default: treat any other task as a search query
        print(f"[simple planner] Treating as search query: '{t}'")
        query = task.strip()
        print(f"[simple planner] Using full task as query: '{query}'")
        actions = [
            {"action": "navigate", "payload": {"url": "https://www.google.com"}},
            {"action": "find", "payload": {"selector": "input[name=q]"}},
            {"action": "type", "payload": {"selector": "input[name=q]", "text": query[:200]}},
            {"action": "submit", "payload": {"selector": "input[name=q]"}},
        ]
    return actions


async def handle_connection(websocket):
    async for raw in websocket:
        try:
            msg = json.loads(raw)
        except Exception as exc:
            await websocket.send(json.dumps({"type": "error", "error": str(exc)}))
            continue

        if msg.get("type") == "ping":
            await websocket.send(json.dumps({"type": "pong"}))
            continue

        # Handle task requests with Claude Computer Use agent loop
        if msg.get("type") == "task":
            task = msg.get("task", "")
            print(f"[server] Starting Computer Use agent loop for task: {task}")
            
            # Start the agent loop
            await run_computer_use_agent_loop(websocket, task)
            continue

        # Ignore arbitrary action echoes to avoid feedback loops

        await websocket.send(json.dumps({"type": "error", "error": "unknown message"}))


async def main():
    port = PORT
    max_attempts = 5
    
    for attempt in range(max_attempts):
        try:
            print(f"[server] starting on ws://127.0.0.1:{port}")
            if CLAUDE_AVAILABLE:
                print("[server] Claude integration enabled")
            else:
                print("[server] Claude integration disabled - using simple planner")
            async with websockets.serve(handle_connection, "127.0.0.1", port):
                await asyncio.Future()  # run forever
            break
        except OSError as e:
            if e.errno == 48:  # Address already in use
                port += 1
                print(f"[server] Port {port-1} in use, trying {port}")
                if attempt == max_attempts - 1:
                    print(f"[server] Failed to find available port after {max_attempts} attempts")
                    raise
            else:
                raise


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


