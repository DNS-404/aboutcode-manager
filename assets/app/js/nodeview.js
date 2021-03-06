/*
 #
 # Copyright (c) 2016 nexB Inc. and others. All rights reserved.
 # http://nexb.com and https://github.com/nexB/scancode-toolkit/
 # The ScanCode software is licensed under the Apache License version 2.0.
 # AboutCode is a trademark of nexB Inc.
 #
 # You may not use this software except in compliance with the License.
 # You may obtain a copy of the License at: http://apache.org/licenses/LICENSE-2.0
 # Unless required by applicable law or agreed to in writing, software distributed
 # under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 # CONDITIONS OF ANY KIND, either express or implied. See the License for the
 # specific language governing permissions and limitations under the License.
 #
 */

class NodeView {
    constructor(config) {
        this.config = config;
        this.handlers = {};
        this.reload();
    }

    reload() {
        this.nextId = 0;

        this.orientation = NodeView.orientation(this.config.orientation);
        this.x = (d) => this.orientation.x(d);
        this.y = (d) => this.orientation.y(d);

        this.zoom = d3.behavior.zoom()
            .x(d3.scale.linear())
            .y(d3.scale.linear())
            .on("zoom", () => {
                this.container.attr("transform",
                    `translate(${d3.event.translate})` +
                    `scale(${d3.event.scale})`
                );
            });

        // Clear the selector DOM element in case something already exists.
        $(this.config.selector).empty();
        const svg = d3.select(this.config.selector)
            .append("svg")
            .attr("preserveAspectRatio", "xMinYMin meet")
            .attr("viewBox", "-150 -150 1000 1000")
            .classed("nodeview-content", true)
            .call(this.zoom);

        this.container = svg.append("g")
            .attr("id", "node-group");

        this.tree = d3.layout.tree()
            .nodeSize([this.config.nodeWidth, this.config.nodeHeight]);

        this.diagonal = d3.svg.diagonal().projection((d)=> {
            return [this.x(d), this.y(d)];
        });

        this.nodeData = {};
    }

    on(event, handler) {
        this.handlers[event] = handler;
        return this;
    }

    // Center node and reset scaling
    centerNode() {
        d3.select("g#node-group")
            .transition()
            .duration(750)
            .call(this.zoom.translate([0,0]).scale(1).event);
    }

    // Set the root of the node view to the given root
    setRoot(root) {
        if (!root) {
            return;
        }

        this.nodeData[root.id] = root;

        this.currentId = root.id;
        this._update(root.id);
    }

    toggle(id) {
        // _children will be undefined the first time the node is toggled
        if (this.nodeData[id]._children === undefined) {
            this.handlers['get-children'](id)
                .then(children => {
                    if (children !== undefined) {
                        this.nodeData[id]._children = children;
                        children.forEach(child => {
                            this.nodeData[child.id] = child;
                        });
                        this.toggle(id);
                    }
                });
        } else {
            // Toggle whether the node is opened and update the view.
            this.nodeData[id].isOpened = !this.nodeData[id].isOpened;
            this._update(this.currentId, id);
        }
    }

    redraw() {
        if (this.currentId) {
            this._update(this.currentId);
        }
    }

    // Resize the spacing between nodes
    resize(nodeWidth, nodeHeight) {
        this.tree.nodeSize([nodeWidth, nodeHeight]);
        this._update(this.currentId);
    }

    _translate(d) {
        return `translate(${this.x(d)}, ${this.y(d)})`;
    }

    _update(rootId, toggleId) {
        // Get the position of the node with toggleId so that we can collapse
        // or expand the child nodes to or from that position
        const prevPos = NodeView._pos(this.nodeData[toggleId || this.currentId]);

        // Update the root and current id if it has changed.
        const newRoot = this.nodeData[rootId];
        this.currentId = rootId;

        const prunedRoot = this.handlers['prune-nodes'](newRoot);
        // Calculate positions of each node or return an empty array if there are no nodes
        const nodeData = prunedRoot ? this.tree.nodes(prunedRoot) : [];
        const currPos = NodeView._pos(this.nodeData[toggleId || this.currentId]);

        // Handle nodes
        const nodes = this.container.selectAll("g.node")
            .data(nodeData, (d) => d.id || (d.id = this.nextId++));
        this._updateNodes(nodes);
        this._addNodes(nodes.enter(), prevPos);
        this._removeNodes(nodes.exit(), currPos);

        // Handle links
        const linkData = this.tree.links(nodeData);
        const links = this.container.selectAll("path.link")
            .data(linkData, (d) => d.target.id);
        this._updateLinks(links);
        this._addLinks(links.enter(), prevPos);
        this._removeLinks(links.exit(), currPos);
    }

    _addNodes(node, pos) {
        // create Node group
        const nodeGroup = node.append("g").attr("class", "node")
            .attr("transform", () => this._translate(pos))
            .style("opacity", 0);

        // Add custom elements
        this.handlers['add-nodes'](nodeGroup);
        this._updateNodes(nodeGroup);
    }

    _updateNodes(nodes) {
        // Animate Node group open
        nodes.transition().duration(this.config.duration)
            .attr("transform", (d) => this._translate(NodeView._pos(d)))
            .style("opacity", 1);

        // Update custom elements
        this.handlers['update-nodes'](nodes);
    }

    _removeNodes(nodes, pos) {
        // Transition exiting nodes to the clicked source's position.
        nodes.transition().duration(this.config.duration)
            .attr("transform", () => this._translate(pos))
            .style("opacity", 0)
            .remove();

        // Transition exiting nodes radius to 0
        nodes.select("circle").transition().duration(this.config.duration)
            .attr("r", 0);
    }

    _addLinks(link, pos) {
        const linkGroup = link.insert("path", "g")
            .attr("class", "link")
            .attr("d", () => this.diagonal({source: pos, target: pos}));

        this._updateLinks(linkGroup);
    }

    _updateLinks(links) {
        // Transition links to their new position.
        links.transition().duration(this.config.duration)
            .attr("d", this.diagonal)
            .style("opacity", 1);
    }

    _removeLinks(links, pos) {
        // Transition exiting nodes to the parent's new position.
        links.transition().duration(this.config.duration)
            .attr("d", () => this.diagonal({source: pos, target: pos}))
            .style("opacity", 0)
            .remove();
    }

    static orientation(orientKey) {
        if (orientKey === "top-to-bottom") {
            return {
                x: (node) => node.x,
                y: (node) => node.y
            };
        } else if (orientKey === "left-to-right") {
            return {
                x: (node) => node.y,
                y: (node) => node.x
            };
        }
    }

    static _pos(node) {
        return {x: node.x || 0, y: node.y || 0};
    }
}

module.exports = NodeView;