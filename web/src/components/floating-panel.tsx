import { cn } from "cn";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible } from "radix-ui";
import type * as React from "react";

import { Card, CardContent } from "#/components/ui/card";

// The panel floating in the top-left corner of both pages. Tapping the
// title folds it down to just the title, so the view behind it can be seen
// on a small screen. `className` sets the width (and anything else) of the
// card; `children` are what folds away. Pass `open` and `onOpenChange` to
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
				"absolute top-3 left-3 z-10 gap-0 py-0 shadow-lg",
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
