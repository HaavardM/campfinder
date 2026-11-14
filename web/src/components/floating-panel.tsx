import { cn } from "cn";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible } from "radix-ui";
import type * as React from "react";

import { Card, CardContent } from "#/components/ui/card";

// The panel floating in the top-left corner of both pages. Tapping the
// title folds it down to just the title, so the view behind it can be seen
// on a small screen. `className` sets the width (and anything else) of the
// card; `children` are what folds away. It keeps clear of an iPhone's
// camera cutout and home bar, and scrolls rather than run off the screen. Pass `open` and `onOpenChange` to
// fold it from outside as well.
export function FloatingPanel(props: {
	title: string;
	icon: LucideIcon;
	className?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: React.ReactNode;
}) {
	return (
		<Card
			className={cn(
				"absolute z-10 gap-0 overflow-auto py-0 shadow-lg",
				"top-[max(--spacing(3),env(safe-area-inset-top))] left-[max(--spacing(3),env(safe-area-inset-left))]",
				"max-h-[calc(100dvh-max(--spacing(3),env(safe-area-inset-top))-max(--spacing(3),env(safe-area-inset-bottom)))]",
				"max-w-[calc(100vw-max(--spacing(3),env(safe-area-inset-left))-max(--spacing(3),env(safe-area-inset-right)))]",
				props.className,
			)}
		>
			<Collapsible.Root
				asChild
				defaultOpen
				open={props.open}
				onOpenChange={props.onOpenChange}
			>
				<CardContent className="flex flex-col p-3">
					<Collapsible.Trigger
						className="group flex items-center gap-2 font-semibold"
						title="Show or hide the menu"
					>
						<props.icon className="size-5" />
						{props.title}
						<ChevronDown className="ml-auto size-5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
					</Collapsible.Trigger>

					<Collapsible.Content className="-mx-1 overflow-hidden px-1 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
						{props.children}
					</Collapsible.Content>
				</CardContent>
			</Collapsible.Root>
		</Card>
	);
}
