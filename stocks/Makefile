.PHONY: setup test scan watch evaluate doctor live-agent

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip
	.venv/bin/python -m pip install -r requirements.txt
	.venv/bin/python -m pip install -e .

test:
	.venv/bin/python -m pytest

scan:
	.venv/bin/python -m stock_guru scan

watch:
	.venv/bin/python -m stock_guru watch --interval 60

evaluate:
	.venv/bin/python -m stock_guru evaluate --cache-first-history --history-cache-hours 36

doctor:
	.venv/bin/python -m stock_guru doctor --cache-first-history --history-cache-hours 36

live-agent:
	.venv/bin/python -m stock_guru live-agent --cache-first-history --history-cache-hours 36
