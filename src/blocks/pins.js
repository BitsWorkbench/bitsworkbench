/**
 * Pins, for any MicroPython or CircuitPython board (the generic target): the
 * handful of things where the two Pythons differ and a beginner needs them
 * first. A digital pin out and in, an analog pin in, and a millisecond clock.
 * Everything else (logic, loops, maths, text, lists) is the same Python on
 * both, and so are the general blocks.
 *
 * Each block writes the Python of the flavor being generated for
 * (context.js currentFlavor):
 *
 *   MicroPython    Pin('LED', Pin.OUT).value(True)    from machine import Pin
 *                  Pin(14, Pin.IN, Pin.PULL_UP).value()
 *                  ADC(Pin(26)).read_u16()           from machine import ADC
 *                  time.ticks_ms()
 *   CircuitPython  pin_LED.value = True              made once, after the imports:
 *                  pin_GP14.value                      pin_LED = digitalio.DigitalInOut(board.LED)
 *                  adc_A0.value                        pin_LED.switch_to_output()
 *                  int(time.monotonic() * 1000)
 *
 * MicroPython makes a pin object where it is used, as its examples do.
 * CircuitPython claims a pin once and keeps it, so the object is made in the
 * program's setup (generate.js setupLines) and the block uses it by name.
 * A pin read is pulled up: a button wired to ground reads 0 when pressed.
 */
import { Order } from 'blockly/python'
import { defineBlocks, value } from './define.js'
import { need, currentFlavor } from './context.js'

/** The pin a field names, as an identifier-safe name ('GP15', 'LED', 'A0', '14'). */
export function pinName(block) {
  return String(block.getFieldValue('PIN') || '').replace(/\W/g, '') || 'LED'
}

/** A pin as MicroPython's Pin() takes it: a number, or a name in quotes. */
const mpPin = (name, gen) => (/^\d+$/.test(name) ? name : gen.quote_(name))

/** A pin as CircuitPython's `board` module names it (a bare number is a D pin). */
const cpPin = (name) => (/^\d/.test(name) ? `D${name}` : name)

const mp = () => currentFlavor() === 'micropython'

defineBlocks([
  {
    json: {
      type: 'pins_write',
      args0: [
        { type: 'field_input', name: 'PIN', text: 'LED', spellcheck: false },
        { type: 'input_value', name: 'ON', check: ['Boolean', 'Number'] },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'pins_blocks',
    },
    python: (block, gen) => {
      const name = pinName(block)
      const on = value(gen, block, 'ON', 'True')
      if (mp()) {
        need('machine_pin')
        return `Pin(${mpPin(name, gen)}, Pin.OUT).value(${on})\n`
      }
      need('board', 'digitalio', `pin_out:${cpPin(name)}`)
      return `pin_${cpPin(name)}.value = ${on}\n`
    },
  },
  {
    json: {
      type: 'pins_read',
      args0: [{ type: 'field_input', name: 'PIN', text: 'GP14', spellcheck: false }],
      output: ['Boolean', 'Number'],
      style: 'pins_blocks',
    },
    python: (block, gen) => {
      const name = pinName(block)
      if (mp()) {
        need('machine_pin')
        return [`Pin(${mpPin(name, gen)}, Pin.IN, Pin.PULL_UP).value()`, Order.FUNCTION_CALL]
      }
      need('board', 'digitalio', `pin_in:${cpPin(name)}`)
      return [`pin_${cpPin(name)}.value`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'pins_analog',
      args0: [{ type: 'field_input', name: 'PIN', text: 'A0', spellcheck: false }],
      output: 'Number',
      style: 'pins_blocks',
    },
    python: (block, gen) => {
      const name = pinName(block)
      if (mp()) {
        need('machine_pin', 'machine_adc')
        return [`ADC(Pin(${mpPin(name, gen)})).read_u16()`, Order.FUNCTION_CALL]
      }
      need('board', 'analogio', `adc:${cpPin(name)}`)
      return [`adc_${cpPin(name)}.value`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'pins_ms',
      output: 'Number',
      style: 'pins_blocks',
    },
    python: () => {
      need('time')
      return mp() ? ['time.ticks_ms()', Order.FUNCTION_CALL] : ['int(time.monotonic() * 1000)', Order.FUNCTION_CALL]
    },
  },
])

/** The lines that claim CircuitPython's pins, once, after the imports: from needs like `pin_out:LED`. */
export function pinSetupLines(needs) {
  const lines = []
  for (const key of needs) {
    const [kind, name] = key.split(':')
    if (kind === 'pin_out') lines.push(`pin_${name} = digitalio.DigitalInOut(board.${name})`, `pin_${name}.switch_to_output()`)
    else if (kind === 'pin_in') lines.push(`pin_${name} = digitalio.DigitalInOut(board.${name})`, `pin_${name}.switch_to_input(pull=digitalio.Pull.UP)`)
    else if (kind === 'adc') lines.push(`adc_${name} = analogio.AnalogIn(board.${name})`)
  }
  return lines
}

/** A line pinSetupLines writes (so Python back to blocks leaves it to the blocks to write again). */
export function isPinSetupLine(text) {
  return (
    /^(pin_\w+ = digitalio\.DigitalInOut|adc_\w+ = analogio\.AnalogIn)\(board\.\w+\)$/.test(text) ||
    /^pin_\w+\.switch_to_(output\(\)|input\(pull=digitalio\.Pull\.UP\))$/.test(text)
  )
}
