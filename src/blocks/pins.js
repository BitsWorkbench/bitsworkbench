/**
 * Pins, for any MicroPython or CircuitPython board (the generic target): the
 * handful of things where the two Pythons differ and a beginner needs them
 * first. A digital pin out and in, an analog pin in, and a millisecond clock.
 * Everything else (logic, loops, maths, text, lists) is the same Python on
 * both, and so are the general blocks.
 *
 * Each pin is claimed once, in the program's setup after the imports
 * (generate.js setupLines), and the blocks use it by name, in the Python of
 * the flavor being generated for (context.js currentFlavor):
 *
 *                  setup                                        blocks
 *   MicroPython    pin_LED = Pin('LED', Pin.OUT)                pin_LED.value(True)
 *                  pin_GP14 = Pin('GP14', Pin.IN, Pin.PULL_UP)  pin_GP14.value()
 *                  adc_GP26 = ADC(Pin('GP26'))                  adc_GP26.read_u16()
 *                                                               time.ticks_ms()
 *   CircuitPython  pin_LED = digitalio.DigitalInOut(board.LED)  pin_LED.value = True
 *                  pin_LED.switch_to_output()                   pin_GP14.value
 *                  adc_A0 = analogio.AnalogIn(board.A0)         adc_A0.value
 *                                                               int(time.monotonic() * 1000)
 *
 * CircuitPython must claim a pin once (a second claim is "in use"), and one
 * object per pin also lets a program read back a pin it drives (a toggle:
 * set pin LED to not pin LED is on): a pin that is ever set is an output, and
 * reading it gives what it was set to; a pin only read is an input, pulled
 * up, so a button wired from it to ground reads off while pressed.
 */
import { Order } from 'blockly/python'
import { defineBlocks, value } from './define.js'
import { need, currentFlavor } from './context.js'

const mp = () => currentFlavor() === 'micropython'

/**
 * The pin a block names, as the name its object takes (pin_<name>): the
 * field's letters and digits; on CircuitPython a bare number is a D pin.
 */
export function pinName(block) {
  const name = String(block.getFieldValue('PIN') || '').replace(/\W/g, '') || 'LED'
  return !mp() && /^\d/.test(name) ? `D${name}` : name
}

/** A pin as MicroPython's Pin() takes it: a number, or a name in quotes. */
const mpPin = (name) => (/^\d+$/.test(name) ? name : `'${name}'`)

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
      need(...(mp() ? ['machine_pin'] : ['board', 'digitalio']), `pin_out:${name}`)
      return mp() ? `pin_${name}.value(${on})\n` : `pin_${name}.value = ${on}\n`
    },
  },
  {
    json: {
      type: 'pins_read',
      args0: [{ type: 'field_input', name: 'PIN', text: 'GP14', spellcheck: false }],
      output: ['Boolean', 'Number'],
      style: 'pins_blocks',
    },
    python: (block) => {
      const name = pinName(block)
      need(...(mp() ? ['machine_pin'] : ['board', 'digitalio']), `pin_in:${name}`)
      return mp() ? [`pin_${name}.value()`, Order.FUNCTION_CALL] : [`pin_${name}.value`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'pins_analog',
      args0: [{ type: 'field_input', name: 'PIN', text: 'A0', spellcheck: false }],
      output: 'Number',
      style: 'pins_blocks',
    },
    python: (block) => {
      const name = pinName(block)
      need(...(mp() ? ['machine_pin', 'machine_adc'] : ['board', 'analogio']), `adc:${name}`)
      return mp() ? [`adc_${name}.read_u16()`, Order.FUNCTION_CALL] : [`adc_${name}.value`, Order.MEMBER]
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

/**
 * The lines that claim the pins, once each, after the imports: from needs
 * like `pin_out:LED`. A pin set anywhere is an output (reading it reads back
 * what it was set to); a pin only read is a pulled-up input.
 */
export function pinSetupLines(needs) {
  const digital = new Map() // name -> 'out' | 'in', in the order first needed
  const analog = []
  for (const key of needs) {
    const [kind, name] = key.split(':')
    if (kind === 'pin_out') digital.set(name, 'out')
    else if (kind === 'pin_in' && !digital.has(name)) digital.set(name, 'in')
    else if (kind === 'adc') analog.push(name)
  }
  const lines = []
  for (const [name, dir] of digital) {
    if (mp()) lines.push(`pin_${name} = Pin(${mpPin(name)}, ${dir === 'out' ? 'Pin.OUT' : 'Pin.IN, Pin.PULL_UP'})`)
    else lines.push(`pin_${name} = digitalio.DigitalInOut(board.${name})`, `pin_${name}.${dir === 'out' ? 'switch_to_output()' : 'switch_to_input(pull=digitalio.Pull.UP)'}`)
  }
  for (const name of analog) lines.push(mp() ? `adc_${name} = ADC(Pin(${mpPin(name)}))` : `adc_${name} = analogio.AnalogIn(board.${name})`)
  return lines
}

/**
 * A line pinSetupLines writes, for the pin it names (so Python back to blocks
 * leaves it to the blocks to write again). A line whose object and pin
 * differ (`pin_A = ...(board.B)`) is the student's own, not one of these.
 */
const SETUP = [
  /^pin_(\w+) = digitalio\.DigitalInOut\(board\.\1\)$/,
  /^adc_(\w+) = analogio\.AnalogIn\(board\.\1\)$/,
  /^pin_\w+\.switch_to_(output\(\)|input\(pull=digitalio\.Pull\.UP\))$/,
  /^pin_(\w+) = Pin\(('|"|)\1\2, Pin\.(OUT|IN, Pin\.PULL_UP)\)$/,
  /^adc_(\w+) = ADC\(Pin\(('|"|)\1\2\)\)$/,
]
export function isPinSetupLine(text) {
  return SETUP.some((re) => re.test(text))
}
