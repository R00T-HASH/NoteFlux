"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogTrigger 
} from "@/components/ui/dialog";
import { MessageSquare } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormMessage, Message } from "@/components/form-message";
import { submitFeedbackAction } from "@/app/actions";

interface FeedbackButtonProps {
  userEmail?: string;
}

export function FeedbackButton({ userEmail }: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const handleSubmit = async (formData: FormData) => {
    try {
      // Auto-fill email if user is authenticated
      if (userEmail) {
        formData.set("email", userEmail);
      }
      
      const result = await submitFeedbackAction(formData);
      if (result?.success) {
        setMessage({ success: "Thank you for your feedback!" });
        setTimeout(() => {
          setOpen(false);
          setMessage(null);
        }, 2000);
      } else if (result?.error) {
        setMessage({ error: result.error });
      }
    } catch (error) {
      setMessage({ error: "Something went wrong. Please try again." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          className="text-green-400 hover:text-green-300 hover:bg-gray-800/50 transition-all duration-300 border border-green-500/30 hover:border-green-500/70 hover:shadow-[0_0_15px_rgba(34,197,94,0.3)] rounded-lg shadow-[0_0_8px_rgba(34,197,94,0.15)]"
          title="Send Feedback"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-lg neo-blur border border-green-500/50 shadow-[0_0_30px_rgba(34,197,94,0.2)] rounded-xl">
        <DialogHeader className="space-y-4 pb-2">
          <DialogTitle className="flex items-center gap-3 text-xl text-white">
            <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
              <MessageSquare className="h-5 w-5 text-green-400" />
            </div>
            Send Feedback
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-base">
            Help us improve Noteflux by sharing your thoughts and suggestions.
          </DialogDescription>
        </DialogHeader>
        
        <form action={handleSubmit} className="space-y-5 mt-4">
          {/* Only show email field for non-authenticated users */}
          {!userEmail && (
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-gray-300">
                Email Address
              </Label>
              <Input 
                name="email" 
                type="email"
                placeholder="your@email.com"
                className="h-11 neo-blur border border-gray-600/50 focus:border-green-500/70 focus:ring-2 focus:ring-green-500/20 bg-black/20 text-white placeholder:text-gray-500"
                required
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="type" className="text-sm font-medium text-gray-300">
              Feedback Type
            </Label>
            <Select name="type" required>
              <SelectTrigger className="h-11 neo-blur border border-gray-600/50 focus:border-green-500/70 focus:ring-2 focus:ring-green-500/20 bg-black/20 text-white">
                <SelectValue placeholder="What kind of feedback is this?" />
              </SelectTrigger>
              <SelectContent className="neo-blur border border-gray-600/50 bg-black/90">
                <SelectItem value="feature" className="focus:bg-gray-800/70 text-gray-300 hover:text-white">
                  <div className="flex items-center gap-3">
                    <span>🚀</span>
                    <span>Feature Request</span>
                  </div>
                </SelectItem>
                <SelectItem value="bug" className="focus:bg-gray-800/70 text-gray-300 hover:text-white">
                  <div className="flex items-center gap-3">
                    <span>🐛</span>
                    <span>Bug Report</span>
                  </div>
                </SelectItem>
                <SelectItem value="improvement" className="focus:bg-gray-800/70 text-gray-300 hover:text-white">
                  <div className="flex items-center gap-3">
                    <span>✨</span>
                    <span>Improvement</span>
                  </div>
                </SelectItem>
                <SelectItem value="general" className="focus:bg-gray-800/70 text-gray-300 hover:text-white">
                  <div className="flex items-center gap-3">
                    <span>💭</span>
                    <span>General Feedback</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="message" className="text-sm font-medium text-gray-300">
              Your Message
            </Label>
            <Textarea 
              name="message"
              placeholder="Share your thoughts, ideas, or report issues..."
              className="min-h-[120px] neo-blur border border-gray-600/50 focus:border-green-500/70 focus:ring-2 focus:ring-green-500/20 bg-black/20 text-white placeholder:text-gray-500 resize-none"
              required
            />
          </div>
          
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700/30">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setOpen(false)}
              className="neo-blur border border-gray-600/50 hover:border-gray-500 bg-black/20 text-gray-300 hover:text-white hover:bg-gray-800/50 transition-all duration-300"
            >
              Cancel
            </Button>
            <SubmitButton 
              pendingText="Sending..."
              className="bg-green-600 hover:bg-green-700 text-white px-6 shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] transition-all duration-300 border border-green-500/50"
            >
              Send Feedback
            </SubmitButton>
          </div>
          
          {message && (
            <div className="pt-2">
              <FormMessage message={message} />
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
} 