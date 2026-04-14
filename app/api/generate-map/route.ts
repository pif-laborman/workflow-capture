import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { WorkflowDocument } from '@/lib/types';

const MAP_SYSTEM_PROMPT = `You generate interactive SVG flowcharts from process descriptions. Output ONLY the raw SVG markup, no markdown fences, no explanation.

Follow these rules strictly:

- Top-to-bottom flow, 680px wide viewBox
- Size every node wide enough to fit its label text; never let text overflow a box
- Route arrows to avoid crossing unrelated nodes; use L-shaped paths if needed
- Color encodes step type, not sequence. Use: gray pills for start/end, teal for setup, purple for the core loop steps, blue for output, amber for monitoring/alerting, red dashed for error/skip paths
- Wrap the repeating loop in a dashed container with a label
- Two lines per node max: bold title + short 12px subtitle
- Error/failure path runs as a dashed red line down the right side with a "log & skip" label
- Every node gets a data-step attribute with the step number
- Color legend at the bottom
- Set viewBox height to fit all content. Do not cut off nodes.
- Use readable font sizes: 14px for titles, 12px for subtitles
- Add 20px padding between nodes vertically`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key' }, { status: 500 });
  }

  let body: { workflow: WorkflowDocument };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const workflow = body.workflow;
  if (!workflow?.steps?.length) {
    return NextResponse.json({ error: 'No steps provided' }, { status: 400 });
  }

  // Build the process spec from workflow steps
  const specLines = workflow.steps.map((s) => {
    let line = `${s.step_number}. ${s.action}`;
    if (s.description) line += ` - ${s.description}`;
    if (s.notes) line += ` (${s.notes})`;
    return line;
  });

  const processSpec = `Process: ${workflow.name}
${workflow.description ? `Description: ${workflow.description}` : ''}
${workflow.summary ? `Summary: ${workflow.summary}` : ''}

Steps:
${specLines.join('\n')}

${workflow.open_questions.length > 0 ? `Open questions:\n${workflow.open_questions.map((q) => `- ${q}`).join('\n')}` : ''}`;

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: MAP_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Generate an interactive SVG flowchart for this process:\n\n${processSpec}`,
        },
      ],
    });

    let svg = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        svg += block.text;
      }
    }

    // Strip markdown fences if present
    svg = svg.trim();
    if (svg.startsWith('```')) {
      svg = svg.replace(/^```(?:svg|xml)?\s*/, '').replace(/\s*```$/, '');
    }

    // Validate it looks like SVG
    if (!svg.includes('<svg')) {
      return NextResponse.json({ error: 'Generated content is not SVG' }, { status: 500 });
    }

    return NextResponse.json({ svg });
  } catch (err) {
    console.error('Generate map error:', err);
    return NextResponse.json({ error: 'Failed to generate map' }, { status: 500 });
  }
}
