import _ from 'underscore';
import bridge from '../common/bridge';
import Buffers from './lib/buffers';
import BufferView from './buffer-view';
import InputBox from './input-box';
import ModeManager, {Mode} from './lib/mode-manager';
import Names from './lib/names';
import NameView from './name-view';
import shortcutManager from './lib/shortcut-manager';
import TabNav from './tab-nav';
import React from 'react';

const rootBufferName = '~';

export default class IrcWindow extends React.Component {
  constructor(props) {
    super(props);
    this.modeManager = new ModeManager(Mode.NORMAL);
    this.state = {
      nick: '',
      buffers: new Buffers(rootBufferName),
      mode: this.modeManager.current(),
      names: new Names(),
    };
  }

  setNick(nick) {
    this.setState({nick});
  }

  setBuffers(func) {
    return function (data) {
      func(data);
      this.forceUpdate();
    }.bind(this);
  }

  componentDidMount() {
    this.modeManager.onChange(function (to) {
      this.setState({mode: to});
    }.bind(this));

    // irc events
    bridge.on('registered', data => this.setNick(data.nick));
    bridge.on('message', this.setBuffers(data =>
      this.state.buffers.send(data.to, data.nick, data.text)));
    bridge.on('join', this.join.bind(this));
    bridge.on('part', this.part.bind(this));
    bridge.on('nick', this.changeNick.bind(this));
    bridge.on('names', this.updateNames.bind(this));
    bridge.on('quit', this.quit.bind(this));

    // window events
    bridge.on('focus', this.focusWindow.bind(this));

    // shortcuts
    shortcutManager.on('next-tab', function () {
      this.state.buffers.setCurrent(this.state.buffers.next().name);
      this.forceUpdate();
    }.bind(this));
    shortcutManager.on('previous-tab', function () {
      this.state.buffers.setCurrent(this.state.buffers.previous().name);
      this.forceUpdate();
    }.bind(this));
  }

  setWindowTitle(title) {
    let titleTag = document.getElementsByTagName('title')[0];
    titleTag.innerText = `koko - ${title}`;
  }

  render() {
    this.setWindowTitle(this.props.server);

    let currentBufferName = this.state.buffers.current().name;
    let currentNames = this.state.names.get(currentBufferName);

    return (
      <div id='irc-window'>
        <TabNav buffers={this.state.buffers} />
        <NameView names={currentNames} />
        <BufferView mode={this.state.mode} buffers={this.state.buffers} />
        <InputBox mode={this.state.mode} submit={this.submitInput.bind(this)}
                  blur={this.blurInput.bind(this)} />
      </div>
    );
  }

  submitInput(raw) {
    let target = this.state.buffers.current().name;

    let resetToNormal = true;
    switch (this.state.mode) {
    case Mode.COMMAND:
      bridge.send(Mode.toString(this.state.mode), {raw, context: {target}});
      break;
    case Mode.MESSAGE:
      if (target !== rootBufferName) {
        bridge.send(Mode.toString(this.state.mode), {raw, context: {target}});
        this.state.buffers.send(target, this.state.nick, raw);
        this.forceUpdate();
        resetToNormal = false;
      }
      break;
    }

    if (resetToNormal) {
      this.modeManager.setMode(Mode.NORMAL);
    }
  }

  blurInput() {
    this.modeManager.setMode(Mode.NORMAL);
  }

  join(data) {
    let isMe = data.nick === this.state.nick;
    this.state.buffers.join(data.channel, data.nick, data.message, isMe);
    if (!isMe) {
      this.state.names.add(data.channel, data.nick);
    }
    this.forceUpdate();
  }

  part(data) {
    let isMe = data.nick === this.state.nick;
    this.state.buffers.part(data.channel, data.nick, data.reason, data.message, isMe);
    if (isMe) {
      this.state.names.delete(data.channel);
    } else {
      this.state.names.remove(data.channel, data.nick);
    }
    this.forceUpdate();
  }

  changeNick(data) {
    if (data.oldnick === this.state.nick) {
      this.setState({nick: data.newnick});
      data.channels.push(rootBufferName);
    }
    data.channels.forEach(function (channel) {
      this.state.buffers.changeNick(channel, data.oldnick, data.newnick);
      this.state.names.update(channel, data.oldnick, data.newnick);
    }.bind(this));
    this.forceUpdate();
  }

  updateNames(data) {
    let names = Object.keys(data.names).map(function (name) {
      return {name, mode: data.names[name], isMe: name === this.state.nick}
    }.bind(this));
    this.state.names.set(data.channel, names);
    this.forceUpdate();
  }

  quit(data) {
    data.channels.forEach(function (channel) {
      let dataForChannel = _.extend(_.omit(data, 'channels'), {channel});
      this.part(dataForChannel);
    }.bind(this));
  }

  focusWindow() {
    if (this.state.buffers.current().name !== rootBufferName) {
      this.modeManager.setMode(Mode.MESSAGE);
    }
  }
}
