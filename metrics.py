"""Bounded, in-memory tap recording and reproducible millisecond metrics."""
import csv
import io
from datetime import datetime, timezone

from keyconfig import LABELS, DEFAULTS
SHIFT = {160, 161}
LAYOUTS = {name: set(keys) for name, keys in DEFAULTS.items()}


class TapRecorder:
    def __init__(self, limit=50000):
        self.limit = limit
        self.clear()

    def clear(self):
        self.rows = []
        self.active = {}
        self.previous = set()
        self.origin = None
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.running = True
        self.segment = 0
        self.was_paused = False
        self.full = False
        self.sample_gaps = []
        self.last_sample = None

    def interrupt(self, reason):
        for index in self.active.values():
            self.rows[index] = dict(self.rows[index], status=reason)
        self.active.clear()
        self.segment += 1

    def control(self, action):
        if action == 'clear':
            previous = self.previous.copy()
            self.clear()
            self.previous = previous  # Never invent a press for a held key.
        elif action == 'pause':
            self.interrupt('recording_stopped')
            self.running = False
        elif action == 'resume' and not self.full:
            self.running = True

    def update(self, down, now, paused=False):
        # down is the physical state, with no 90ms visual release extension.
        if self.last_sample is not None:
            self.sample_gaps.append((now-self.last_sample)*1000)
            if len(self.sample_gaps)>1000:
                del self.sample_gaps[:500]
        self.last_sample = now
        if paused and not self.was_paused:
            self.interrupt('input_paused')
        self.was_paused = paused
        new = down - self.previous
        self.previous = set(down)
        if not self.running or paused:
            return
        for key in self.active.keys() - down:
            index = self.active.pop(key)
            self.rows[index] = dict(self.rows[index], release=now, status='complete')
        for key in sorted(new):
            if len(self.rows) >= self.limit:
                self.interrupt('limit_reached')
                self.running = False
                self.full = True
                break
            if self.origin is None:
                self.origin = now
            row = dict(id=len(self.rows)+1, key=key, press=now, release=None,
                       segment=self.segment, status='held')
            self.rows.append(row)
            self.active[key] = len(self.rows)-1

    def snapshot(self):
        return dict(rows=list(self.rows), origin=self.origin,
                    started_at=self.started_at, running=self.running, full=self.full,
                    limit=self.limit, samples=self.sample_gaps.copy())


def report(snapshot, layout='4k', bindings=None):
    selected = bindings if bindings is not None else DEFAULTS.get(layout, DEFAULTS['4k'])
    allowed = set(selected)
    shift = {selected[0], selected[-1]}
    rows = [r for r in snapshot['rows'] if r['key'] in allowed]
    groups = {}
    for r in rows:
        if r['key'] not in shift:
            groups.setdefault((r['segment'],r['press']), []).append(r)
    next_group = {}
    times = sorted(groups)
    for i, group in enumerate(times[:-1]):
        following = times[i+1]
        if group[0] == following[0]:
            next_group[group] = following
    following_same = {}
    last = {}
    for r in reversed(rows):
        ident = (r['segment'], r['key'])
        following_same[r['id']] = last.get(ident)
        last[ident] = r
    def ms(value):
        return None if value is None else round(value*1000, 3)
    result = []
    for r in rows:
        start, end, key = r['press'], r['release'], r['key']
        group = (r['segment'], start)
        nxt = next_group.get(group) if key not in shift else None
        nxt_time = nxt[1] if nxt else None
        same = following_same[r['id']]
        result.append(dict(
            id=r['id'], key=LABELS[key], segment=r['segment'], status=r['status'],
            press_ms=ms(start-snapshot['origin']),
            release_ms=ms(end-snapshot['origin']) if end is not None else None,
            hold_ms=ms(end-start) if end is not None else None,
            chord_size=len(groups.get(group, [])) if key not in shift else None,
            next_keys=' + '.join(LABELS[n['key']] for n in groups[nxt]) if nxt else None,
            next_press_ms=ms(nxt_time-start) if nxt else None,
            release_to_next_ms=ms(nxt_time-end) if nxt and end is not None else None,
            same_key_next_ms=ms(same['press']-start) if same else None,
        ))
    def stats(values):
        values=sorted(v for v in values if v is not None)
        n=len(values)
        if not n:return dict(count=0,mean_ms=None,min_ms=None,max_ms=None,median_ms=None)
        return dict(count=n,mean_ms=round(sum(values)/n,3),min_ms=values[0],max_ms=values[-1],
                    median_ms=round((values[(n-1)//2]+values[n//2])/2,3))
    nonshift = [r for r in result if r['key'] not in {LABELS[k] for k in shift}]
    # Count each chord onset once in the overall interval statistics.
    intervals = [ms(nxt[1]-group[1]) for group,nxt in next_group.items()]
    return dict(schema_version=2, layout=layout, bindings=selected, auxiliary_keys=[LABELS[k] for k in (selected[0], selected[-1])], started_at_utc=snapshot['started_at'],
        running=snapshot['running'], full=snapshot['full'], limit=snapshot['limit'],
        recorded_total=len(snapshot['rows']), selected_total=len(result),
        definitions=dict(hold_ms='physical release minus press',
            next_press_ms='next strictly later non-auxiliary onset minus press; simultaneous keys form one group',
            release_to_next_ms='next non-auxiliary onset minus release; negative means overlap',
            same_key_next_ms='next press of the same key minus press',
            chord_size='non-auxiliary keys first observed down in the same polling sample',
            precision='OS polling measurement, not game judgment; 3 decimals do not imply microsecond accuracy',
            missing='null/empty means not yet observed, excluded, or interrupted'),
        summary=dict(hold=stats(r['hold_ms'] for r in nonshift),interval=stats(intervals),
            gap=stats(r['release_to_next_ms'] for r in nonshift),
            sampling=stats(snapshot['samples'])),
        by_key={name:stats(r['hold_ms'] for r in result if r['key']==name) for key,name in LABELS.items() if key in allowed},
        taps=result)


FIELDS = ['id','key','segment','status','press_ms','release_ms','hold_ms','chord_size','next_keys',
          'next_press_ms','release_to_next_ms','same_key_next_ms']


def csv_bytes(data):
    stream=io.StringIO(newline='')
    writer=csv.DictWriter(stream, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(data['taps'])
    return stream.getvalue().encode('utf-8-sig')
