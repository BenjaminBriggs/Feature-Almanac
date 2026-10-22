import { describe, expect, it } from 'vitest'
import { parseGherkin } from '@feature-almanac/core'

describe('parseGherkin', () => {
  it('takes the text above the steps as the summary', () => {
    expect(parseGherkin('Saves the note a second after typing stops.\nGiven a note with unsaved edits\nWhen input is idle for 1 second\nThen the note is saved')).toEqual({
      ok: true,
      summary: 'Saves the note a second after typing stops.',
      scenarios: [
        {
          steps: [
            { keyword: 'Given', text: 'a note with unsaved edits' },
            { keyword: 'When', text: 'input is idle for 1 second' },
            { keyword: 'Then', text: 'the note is saved' },
          ],
        },
      ],
    })
  })

  it('takes it from above the first Scenario line too, and leaves it out when there is none', () => {
    const named = parseGherkin('Bold toggles from the keyboard or the menu.\n\nScenario: Keyboard\nWhen the user presses ⌘B\nThen the selection is bold\n\nScenario: Menu\nWhen the user chooses "Bold"\nThen the selection is bold')
    expect(named).toMatchObject({ ok: true, summary: 'Bold toggles from the keyboard or the menu.', scenarios: [{ name: 'Keyboard' }, { name: 'Menu' }] })
    expect(parseGherkin('When the user presses ⌘B\nThen the selection is bold')).not.toHaveProperty('summary')
  })

  it('says what the parser rejects, and where in the description', () => {
    expect(parseGherkin('Given a note\n"""\nsome text\nThen it is saved')).toEqual({
      ok: false,
      message: 'the Gherkin parser rejects it: unexpected end of file, expected: #DocStringSeparator, #Other',
    })
    expect(parseGherkin('Saves notes.\nGiven a note\nFeature: Notes\nThen it is saved')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^the Gherkin parser rejects line 3: expected: #EOF, .*, got 'Feature: Notes'$/),
    })
  })
})
