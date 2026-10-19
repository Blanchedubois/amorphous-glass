// The player shown on the card: the MPRIS player that is playing, else the first one found.
import Gio from 'gi://Gio';

const PREFIX = 'org.mpris.MediaPlayer2.';

export class Player {
    constructor(onChange) {
        this._onChange = onChange;
        this._proxies = new Map();
        this._watch = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE, (c, s, p, i, sig, params) => {
                const [name, , owner] = params.deep_unpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (owner)
                    this._add(name);
                else
                    this._remove(name);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                try {
                    const [names] = bus.call_finish(res).deep_unpack();
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch {}
            });
    }

    _add(name) {
        if (this._proxies.has(name))
            return;
        Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, null, name, '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player', null, (o, res) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(res);
                    proxy._changedId = proxy.connect('g-properties-changed', () => this._onChange?.());
                    this._proxies.set(name, proxy);
                    this._onChange?.();
                } catch {}
            });
    }

    _remove(name) {
        const proxy = this._proxies.get(name);
        if (!proxy)
            return;
        proxy.disconnect(proxy._changedId);
        this._proxies.delete(name);
        this._onChange?.();
    }

    get current() {
        let best = null;
        for (const proxy of this._proxies.values()) {
            const status = proxy.get_cached_property('PlaybackStatus')?.unpack();
            if (status === 'Playing')
                return proxy;
            best ??= proxy;
        }
        return best;
    }

    // {title, artist, artUrl, playing, name} or null
    get state() {
        const proxy = this.current;
        if (!proxy)
            return null;
        const md = proxy.get_cached_property('Metadata')?.deep_unpack() ?? {};
        const unpack = v => (v?.unpack ? v.unpack() : v);
        const artist = unpack(md['xesam:artist']);
        return {
            title: `${unpack(md['xesam:title']) ?? ''}`,
            artist: Array.isArray(artist) ? artist.join(', ') : `${artist ?? ''}`,
            artUrl: `${unpack(md['mpris:artUrl']) ?? ''}`,
            playing: proxy.get_cached_property('PlaybackStatus')?.unpack() === 'Playing',
            name: proxy.g_name.slice(PREFIX.length),
        };
    }

    call(method) {
        this.current?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._watch);
        for (const name of [...this._proxies.keys()])
            this._remove(name);
        this._onChange = null;
    }
}
