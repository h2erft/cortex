# USB RS-485 adapters

Cortex talks to equipment through USB RS-485 adapters plugged into the controller. Any adapter Linux
shows as a serial port works. Each bus needs its own wire: the LG bus on one, each Rheem / Ruud system
on its own.

## Multi-channel adapters

An adapter with several channels saves USB ports: one cable, several buses. The Waveshare
**USB TO 4CH RS485** (CH344 chip) is the one Cortex names and numbers by itself. It needs no driver on
the controller: Linux shows it as four ports.

- Each channel is listed separately, as "Waveshare 4-channel RS485 (CH344) · channel 2 of 4".
  Channel numbers follow the terminals on the case: A1/B1 is channel 1, A2/B2 is channel 2, and so on.
- Channels are independent. The LG bus can be on channel 1 and Rheem / Ruud systems on 2, 3 and 4.
  Each channel uses the speed its own bus needs.
- Cortex saves the choice by the port's stable name, so it survives a replug or a restart.
- Cortex never guesses which channel a bus is on. With a multi-channel adapter someone has to choose.

## Choosing the adapter

- **LG bus:** Bus scan ▸ LG ▸ **Choose adapter…**, pick the adapter or channel, **Use this adapter**.
  If the bus was connected it reconnects on the new one. The first-run setup page offers the same list.
- **Rheem / Ruud system:** Settings ▸ Equipment ▸ Set up now (or Add a system), and pick the channel
  in "USB adapter on the controller". A channel already in use is greyed out and says who uses it.

## Wiring

RS-485 is two wires, A and B. On the Waveshare 4-channel adapter each channel has its own A and B
terminals, and PE is ground. If a bus shows nothing but stray bytes, swap A and B on that channel:
makers do not agree on which is which.

## Not verified on real hardware

The channel order (first port = terminals A1/B1) follows how the chip presents its ports; confirm it once
on the bench by connecting one bus and seeing which channel hears it.
